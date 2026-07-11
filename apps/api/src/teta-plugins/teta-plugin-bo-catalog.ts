import { Logger } from '@nestjs/common';
import * as path from 'path';
import {
  extractGatewayMetadataFromDllText,
  findBusinessObjectReferences,
  findGatewayClassNames,
  readDllStrings,
} from './teta-dll-string-scanner';
import { pluginStemFromDllName, type TetaServerLayout } from './teta-server-layout.util';

type DllStringCacheEntry = {
  strings: string[];
  joinedText: string;
  gatewayClassNames: string[];
  businessObjectRefs: string[];
};

const logger = new Logger('TetaPluginBoCatalog');

export class TetaPluginBoCatalog {
  private readonly dllCache = new Map<string, DllStringCacheEntry>();
  private readonly gatewayToDll = new Map<string, string>();

  constructor(private readonly layout: TetaServerLayout) {
    logger.log(
      `Katalog serwera: ${layout.businessObjectDlls.length} DLL w BusinessObjects, ${layout.interfaceDlls.length} w Interfaces (lazy load).`,
    );
  }

  get serverDirectory(): string {
    return this.layout.serverDirectory;
  }

  resolveRelatedBoDlls(options: {
    pluginDllPath: string;
    pluginDllName: string;
    pluginClassName?: string | null;
    referencedBoFromSource?: string[];
    referencedGatewaysFromSource?: string[];
  }): string[] {
    const pluginEntry = this.loadDllEntry(options.pluginDllPath);
    const resolved = new Set<string>();
    const pluginStem = pluginStemFromDllName(options.pluginDllName).toLowerCase();

    for (const dllPath of this.layout.businessObjectDlls) {
      if (this.shouldSkipBoDll(dllPath)) continue;
      const fileName = path.basename(dllPath, '.dll').toLowerCase();
      if (fileName.includes(pluginStem) || pluginStem.includes(fileName.replace(/^bos/i, ''))) {
        resolved.add(dllPath);
      }
    }

    const boRefs = new Set<string>([
      ...pluginEntry.businessObjectRefs,
      ...(options.referencedBoFromSource ?? []),
    ]);
    for (const fqName of boRefs) {
      const dllPath = this.findBoDllForClass(fqName);
      if (dllPath) resolved.add(dllPath);
    }

    const related = [...resolved];
    for (const dllPath of related) {
      this.registerGatewayClassesFromDll(dllPath);
    }

    for (const gatewayClassName of [
      ...(options.referencedGatewaysFromSource ?? []),
      ...pluginEntry.gatewayClassNames,
    ]) {
      let dllPath = this.gatewayToDll.get(gatewayClassName.toLowerCase());
      if (!dllPath) {
        dllPath = this.findDllContainingClass(gatewayClassName, related) ?? undefined;
      }
      if (dllPath) resolved.add(dllPath);
    }

    return [...resolved].sort((a, b) => a.localeCompare(b, 'pl'));
  }

  findGatewayDll(className: string, searchDlls?: string[]): string | null {
    return (
      this.gatewayToDll.get(className.toLowerCase()) ??
      this.findDllContainingClass(className, searchDlls)
    );
  }

  ensureGatewayRegistered(className: string, dllPath: string): void {
    this.gatewayToDll.set(className.toLowerCase(), dllPath);
    this.registerGatewayClassesFromDll(dllPath);
  }

  listGatewayClassNames(dllPaths: string[]): string[] {
    const result = new Set<string>();
    for (const dllPath of dllPaths) {
      if (this.shouldSkipBoDll(dllPath)) continue;
      for (const gatewayClassName of this.loadDllEntry(dllPath).gatewayClassNames) {
        if (/^m_/i.test(gatewayClassName)) continue;
        result.add(gatewayClassName);
      }
    }
    return [...result].sort((a, b) => a.localeCompare(b, 'pl'));
  }

  extractGatewayMetadata(
    className: string,
    preferredDllPath?: string | null,
    searchDlls?: string[],
  ) {
    const dllPath =
      preferredDllPath ??
      this.gatewayToDll.get(className.toLowerCase()) ??
      this.findDllContainingClass(className, searchDlls);

    if (!dllPath) {
      return null;
    }

    const entry = this.loadDllEntry(dllPath);
    const metadata = extractGatewayMetadataFromDllText(className, entry.joinedText, entry.strings);
    return {
      dllPath,
      ...metadata,
    };
  }

  private registerGatewayClassesFromDll(dllPath: string): void {
    const entry = this.loadDllEntry(dllPath);
    for (const gatewayClassName of entry.gatewayClassNames) {
      if (!this.gatewayToDll.has(gatewayClassName.toLowerCase())) {
        this.gatewayToDll.set(gatewayClassName.toLowerCase(), dllPath);
      }
    }
  }

  private findDllContainingClass(className: string, searchDlls?: string[]): string | null {
    const scope = (searchDlls?.length ? searchDlls : this.layout.businessObjectDlls).filter(
      (dllPath) => !this.shouldSkipBoDll(dllPath),
    );
    for (const dllPath of scope) {
      if (
        this.loadDllEntry(dllPath).gatewayClassNames.some(
          (name) => name.toLowerCase() === className.toLowerCase(),
        )
      ) {
        this.gatewayToDll.set(className.toLowerCase(), dllPath);
        return dllPath;
      }
    }
    return null;
  }

  private findBoDllForClass(fqName: string): string | null {
    const simple = fqName.split('.').pop()?.replace(/BO$/i, '') ?? '';
    if (!simple) return null;

    const candidates = this.layout.businessObjectDlls.filter((dllPath) => {
      if (this.shouldSkipBoDll(dllPath)) return false;
      const base = path.basename(dllPath, '.dll').toLowerCase();
      const token = simple.toLowerCase();
      return base === `bos${token}` || base.includes(token) || token.includes(base.replace(/^bos/i, ''));
    });

    if (candidates.length === 1) {
      return candidates[0];
    }

    return (
      candidates.find((dllPath) => path.basename(dllPath, '.dll').toLowerCase() === `bos${simple.toLowerCase()}`) ??
      candidates[0] ??
      null
    );
  }

  private shouldSkipBoDll(dllPath: string): boolean {
    const normalized = dllPath.replace(/\\/g, '/');
    if (/\/(en|hu)\//i.test(normalized)) return true;
    if (/\.resources\.dll$/i.test(dllPath)) return true;
    return false;
  }

  private loadDllEntry(dllPath: string): DllStringCacheEntry {
    const cached = this.dllCache.get(dllPath);
    if (cached) return cached;

    logger.debug(`Skan DLL: ${dllPath}`);
    const strings = readDllStrings(dllPath);
    const entry: DllStringCacheEntry = {
      strings,
      joinedText: strings.join('\n'),
      gatewayClassNames: findGatewayClassNames(strings),
      businessObjectRefs: findBusinessObjectReferences(strings),
    };
    this.dllCache.set(dllPath, entry);
    return entry;
  }
}

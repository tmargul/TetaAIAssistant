/**
 * Stage 3D — TetaBusinessRoleResolver.
 * Approved bindings only; discovery never auto-approves.
 */
import { getOntologySubject } from './teta-business-ontology-loader';
import { getSubjectBindings } from './teta-semantic-bindings-loader';
import { discoverCandidates } from './teta-semantic-candidate-discovery';
import { validateRegistry, validateSubjectBindings } from './teta-semantic-binding-validator';
import { resolveValuePath } from './teta-semantic-value-path-resolver';
import { resolveTemporalRule } from './teta-semantic-temporal-rule-resolver';
import {
  STAGE3D_CONTRACT_VERSION,
  STAGE3D_IDENTITY_VERSION,
  type BusinessLanguageFile,
  type BusinessOntologyFile,
  type DiscoveryResult,
  type SemanticBindingsFile,
  type SemanticFormBinding,
  type SemanticProjectionBinding,
  type SemanticRelationBinding,
  type SemanticSourceBinding,
  type SemanticTemporalBinding,
  type SemanticValuePathBinding,
  type Stage3dGraphClient,
  type SubjectSemanticResolution,
  type ValidationResult,
} from './teta-business-semantics.types';

export type { Stage3dGraphClient };

export type TetaBusinessRoleResolverOptions = {
  ontology: BusinessOntologyFile;
  bindings: SemanticBindingsFile;
  language?: BusinessLanguageFile | null;
  resolver: Stage3dGraphClient | null;
  graphSourceHash: string | null;
};

function markStaleStatus<T extends { status: string }>(
  items: T[],
  stale: boolean,
): Array<T & { status: T['status'] }> {
  if (!stale) return items;
  return items.map((item) =>
    item.status === 'approved' ? ({ ...item, status: 'stale' } as T) : item,
  );
}

export class TetaBusinessRoleResolver {
  constructor(private readonly options: TetaBusinessRoleResolverOptions) {}

  get ontology(): BusinessOntologyFile {
    return this.options.ontology;
  }

  get bindings(): SemanticBindingsFile {
    return this.options.bindings;
  }

  get language(): BusinessLanguageFile | null {
    return this.options.language ?? null;
  }

  get graphSourceHash(): string | null {
    return this.options.graphSourceHash;
  }

  validateRegistry(graph: Stage3dGraphClient | null = this.options.resolver): ValidationResult {
    return validateRegistry(this.options.bindings, graph, this.options.graphSourceHash);
  }

  discoverCandidates(subject: string, role: string): DiscoveryResult {
    const ont = getOntologySubject(this.options.ontology, subject);
    if (!ont) {
      return {
        subject,
        role,
        kind: 'source',
        status: 'unresolved',
        candidates: [],
        selectedNodeId: null,
        warnings: ['unknown_subject'],
      };
    }
    return discoverCandidates(this.options.resolver, ont, role);
  }

  getApprovedSource(subject: string, role: string): SemanticSourceBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.sources.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  getApprovedProjection(subject: string, role: string): SemanticProjectionBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.projections.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  getApprovedRelation(subject: string, role: string): SemanticRelationBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.relations.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  getApprovedTemporal(subject: string, role: string): SemanticTemporalBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.temporals.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  getApprovedValuePath(subject: string, role: string): SemanticValuePathBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.valuePaths.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  getApprovedForm(subject: string, role: string): SemanticFormBinding | null {
    const s = getSubjectBindings(this.options.bindings, subject);
    const b = s?.forms?.find((x) => x.role === role) ?? null;
    if (!b || b.status !== 'approved') return null;
    if (this.isStale()) return { ...b, status: 'stale' };
    return b;
  }

  isStale(): boolean {
    const current = this.options.graphSourceHash;
    const registry = this.options.bindings.graphSourceHash;
    return !!(current && registry && current !== registry);
  }

  resolveSubject(subject: string, graphSourceHash?: string | null): SubjectSemanticResolution {
    const hash = graphSourceHash ?? this.options.graphSourceHash;
    const subjectBindings = getSubjectBindings(this.options.bindings, subject);
    const warnings: string[] = [];

    if (!subjectBindings) {
      return {
        contractVersion: STAGE3D_CONTRACT_VERSION,
        subject,
        graphSourceHash: hash,
        identityVersion: STAGE3D_IDENTITY_VERSION,
        status: 'unresolved',
        sources: [],
        projections: [],
        relations: [],
        valuePaths: [],
        temporals: [],
        forms: [],
        validation: {
          ok: false,
          graphSourceHash: hash,
          registryGraphSourceHash: this.options.bindings.graphSourceHash,
          identityVersion: this.options.bindings.identityVersion,
          issues: [
            {
              code: 'subject_missing',
              severity: 'error',
              subject,
              message: `No bindings for subject ${subject}`,
            },
          ],
          stale: false,
          approvedBindingCount: 0,
          invalidBindingCount: 0,
        },
        warnings: ['subject_missing_from_registry'],
      };
    }

    const validation = validateSubjectBindings(
      subjectBindings,
      this.options.bindings,
      this.options.resolver,
      hash,
    );

    const stale = validation.stale;
    const sources = markStaleStatus(subjectBindings.sources, stale);
    const projections = markStaleStatus(subjectBindings.projections, stale);
    const relations = markStaleStatus(subjectBindings.relations, stale);
    const valuePaths = markStaleStatus(subjectBindings.valuePaths, stale);
    const temporals = markStaleStatus(subjectBindings.temporals, stale);
    const forms = markStaleStatus(subjectBindings.forms ?? [], stale);

    // Verify value paths / temporals structurally
    for (const vp of valuePaths) {
      if (vp.status === 'approved' || vp.status === 'stale') {
        const r = resolveValuePath(vp.status === 'approved' ? vp : { ...vp, status: 'approved' });
        if (r.status === 'invalid') {
          warnings.push(`value_path_invalid:${vp.role}`);
        }
      }
    }
    for (const t of temporals) {
      if (t.status === 'approved') {
        const r = resolveTemporalRule(t);
        if (r.status !== 'resolved') warnings.push(`temporal_incomplete:${t.role}`);
      }
    }

    let status: SubjectSemanticResolution['status'] = 'ready';
    if (stale) status = 'stale';
    else if (!validation.ok) status = 'invalid';
    else {
      const requiredSources =
        getOntologySubject(this.options.ontology, subject)?.sourceRoles.filter(
          (r) => r.kind === 'required' || r.kind === 'enrichment',
        ) ?? [];
      const missingRequired = requiredSources.some((r) => {
        const b = sources.find((s) => s.role === r.role);
        return !b || b.status !== 'approved';
      });
      if (missingRequired) status = 'partial';
    }

    return {
      contractVersion: STAGE3D_CONTRACT_VERSION,
      subject,
      graphSourceHash: hash,
      identityVersion: STAGE3D_IDENTITY_VERSION,
      status,
      sources,
      projections,
      relations,
      valuePaths,
      temporals,
      forms,
      validation,
      warnings,
    };
  }
}

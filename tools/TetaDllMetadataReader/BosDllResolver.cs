using System.Security.Cryptography;
using System.Diagnostics;

namespace TetaDllMetadataReader;

internal static class BosDllResolver
{
    public static BosAssemblyResolution Resolve(string assemblyName, IEnumerable<string> searchRoots)
    {
        var name = NormalizeAssemblyName(assemblyName);
        var result = new BosAssemblyResolution
        {
            AssemblyName = name,
            ReferencedTypes = [],
            ReferencedByForms = [],
            CandidatePaths = [],
        };

        var roots = searchRoots
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .Where(Directory.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var candidates = new List<string>();
        foreach (var root in roots)
        {
            CollectDlls(root, name, candidates);
            // Prefer BusinessObjects / Plugins subtrees first by also scanning known children
            foreach (var sub in new[] { "BusinessObjects", "Plugins", "Interfaces" })
            {
                var p = Path.Combine(root, sub);
                if (Directory.Exists(p)) CollectDlls(p, name, candidates);
            }
        }

        candidates = candidates
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToList();
        result.CandidatePaths = candidates;

        if (candidates.Count == 0)
        {
            result.ResolutionStatus = "physical_file_missing";
            return result;
        }

        var hashes = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in candidates)
        {
            try
            {
                var hash = ComputeSha256(path);
                if (!hashes.TryGetValue(hash, out var list))
                {
                    list = [];
                    hashes[hash] = list;
                }
                list.Add(path);
            }
            catch
            {
                result.ResolutionStatus = "unreadable";
                result.ResolvedPath = path;
                return result;
            }
        }

        if (hashes.Count > 1)
        {
            result.ResolutionStatus = "duplicate_different_hash";
            return result;
        }

        var chosen = hashes.Values.First()[0];
        if (candidates.Count > 1)
            result.ResolutionStatus = "duplicate_same_hash";
        else
            result.ResolutionStatus = "resolved";

        result.ResolvedPath = chosen;
        try
        {
            var fi = new FileInfo(chosen);
            result.FileSize = fi.Length;
            result.FileHashSha256 = hashes.Keys.First();
            var ver = FileVersionInfo.GetVersionInfo(chosen);
            result.FileVersion = ver.FileVersion ?? ver.ProductVersion;
        }
        catch
        {
            // keep resolved path even if version read fails
        }

        return result;
    }

    public static string NormalizeAssemblyName(string name)
    {
        var n = name.Trim();
        if (!n.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            n += ".dll";
        return n;
    }

    private static void CollectDlls(string directory, string assemblyName, List<string> into)
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(directory, assemblyName, SearchOption.AllDirectories))
            {
                into.Add(file);
            }
        }
        catch
        {
            // inaccessible subtree
        }
    }

    private static string ComputeSha256(string path)
    {
        using var stream = File.OpenRead(path);
        var hash = SHA256.HashData(stream);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}

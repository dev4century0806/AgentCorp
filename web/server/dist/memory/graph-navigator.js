import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

let cachedGraph = null;
let lastMtime = 0;

const GRAPH_PATH = 'D:/Project/AgentCorp/graphify-out/graph.json';

const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
    'each', 'few', 'for', 'from', 'further',
    'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
    'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
    'just', 'me', 'more', 'most', 'my', 'myself',
    'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', 'she', 'should', 'so', 'some', 'such',
    'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'fix', 'please', 'help', 'code', 'make', 'update', 'change', 'check', 'task', 'test', 'review',
]);

export function loadGraph(customPath = GRAPH_PATH) {
    if (!existsSync(customPath)) {
        return null;
    }
    try {
        const stats = statSync(customPath);
        if (!cachedGraph || stats.mtimeMs > lastMtime) {
            cachedGraph = JSON.parse(readFileSync(customPath, 'utf8'));
            lastMtime = stats.mtimeMs;
        }
        return cachedGraph;
    } catch {
        return null;
    }
}

export function extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9_\-\.]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    return [...new Set(tokens)];
}

export function querySubGraph(queryText, maxNodes = 6, customPath = GRAPH_PATH) {
    const graph = loadGraph(customPath);
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
        return null;
    }

    const keywords = extractKeywords(queryText);
    if (keywords.length === 0) {
        return null;
    }

    const scoredNodes = [];
    for (const node of graph.nodes) {
        const label = (node.label || '').toLowerCase();
        const normLabel = (node.norm_label || '').toLowerCase();
        const file = (node.source_file || '').toLowerCase();

        let score = 0;
        for (const kw of keywords) {
            if (label === kw || normLabel === kw) {
                score += 15;
            } else if (label.startsWith(kw) || normLabel.startsWith(kw)) {
                score += 8;
            } else if (label.includes(kw) || normLabel.includes(kw)) {
                score += 4;
            } else if (file.includes(kw)) {
                score += 2;
            }
        }

        if (score > 0) {
            scoredNodes.push({ node, score });
        }
    }

    scoredNodes.sort((a, b) => b.score - a.score);
    const topMatches = scoredNodes.slice(0, maxNodes).map((s) => s.node);

    if (topMatches.length === 0) {
        return null;
    }

    const selectedIds = new Set(topMatches.map((n) => n.id));
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    const relevantLinks = (graph.links || []).filter(
        (link) => selectedIds.has(link.source) || selectedIds.has(link.target)
    ).slice(0, 8);

    const components = topMatches.map((n) => {
        const loc = n.source_location ? `:${n.source_location}` : '';
        const file = n.source_file || 'unknown';
        const label = n.label || n.norm_label || 'symbol';
        return `- \`${file}${loc}\` (${label})`;
    });

    const relations = [];
    for (const link of relevantLinks) {
        const sNode = nodeMap.get(link.source);
        const tNode = nodeMap.get(link.target);
        if (sNode && tNode) {
            const rel = link.relation || 'relates to';
            relations.push(`- \`${sNode.label || basename(sNode.source_file)}\` ${rel} \`${tNode.label || basename(tNode.source_file)}\``);
        }
    }

    let report = '## Codebase Knowledge Graph (AST Traversal Context)\n';
    report += '### Impacted Components & Locations\n' + components.join('\n') + '\n';
    if (relations.length > 0) {
        report += '\n### Dependency & Call Relationships\n' + relations.join('\n') + '\n';
    }

    return {
        markdown: report,
        nodeCount: topMatches.length,
        nodes: topMatches.map((n) => ({
            id: n.id,
            label: n.label,
            file: n.source_file,
            loc: n.source_location,
        })),
        relationCount: relations.length,
    };
}

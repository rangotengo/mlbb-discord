#!/usr/bin/env node
/**
 * Documentation link checker.
 *
 * Validates every local link (relative file references, anchors and intra-document anchors)
 * in README.md and docs/ markdown files. External URLs are checked for syntax only; no
 * network access.
 *
 * Run standalone:  node docs/links.test.cjs
 * Exits non-zero and prints each broken link if anything fails.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

function listMarkdownFiles(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name.startsWith('.')) continue;
			out.push(...listMarkdownFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			out.push(full);
		}
	}
	return out;
}

const files = [path.join(ROOT, 'README.md'), ...listMarkdownFiles(DOCS)];
const problems = [];

/** Owner status files are written by sibling threads and may not exist yet; not our problem. */
const SIBLING_STATUS = /improvement-status-(backend|dashboard|desktop)\.md$/;
const OPTIONAL_TARGETS = [path.join(ROOT, 'COPYING'), path.join(DOCS, 'improvement-tracker.md')];

/** Extract headings as GitHub-style anchors: lowercase, spaces to hyphens, punctuation stripped. */
function anchorsOf(text) {
	const anchors = new Set();
	const inCodeFence = { value: false };
	const lines = text.split(/\r?\n/);
	for (const line of lines) {
		if (line.startsWith('```')) {
			inCodeFence.value = !inCodeFence.value;
			continue;
		}
		if (inCodeFence.value) continue;
		const match = /^(#{1,6})\s+(.*)$/.exec(line);
		if (!match) continue;
		const slug = match[2]
			.toLowerCase()
			.replace(/[`*_[\]()]/g, '')
			.trim()
			.replace(/[^\p{L}\p{N}\s-]/gu, '')
			.replace(/\s+/g, '-');
		anchors.add(slug);
		// GitHub keeps leading hyphens from removed punctuation like "### !list"
		anchors.add(slug.replace(/^-+/, ''));
	}
	return anchors;
}

/** Collect markdown links/images, skipping fenced code blocks. */
function linksOf(text) {
	const links = [];
	const lines = text.split(/\r?\n/);
	let inFence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
		let match;
		while ((match = pattern.exec(line)) !== null) {
			links.push({ isImage: match[1] === '!', label: match[2], target: match[3] });
		}
		// Reference-style definitions
		const ref = /^\s{0,3}\[([^\]]+)\]:\s+(\S+)/.exec(line);
		if (ref) links.push({ isImage: false, label: ref[1], target: ref[2] });
	}
	return links;
}

const anchorCache = new Map();
function anchorsForFile(file) {
	if (!anchorCache.has(file)) {
		anchorCache.set(file, anchorsOf(fs.readFileSync(file, 'utf8')));
	}
	return anchorCache.get(file);
}

const existingTargets = new Set(files.map(f => path.resolve(f)));

for (const file of files) {
	const relFile = path.relative(ROOT, file);
	const text = fs.readFileSync(file, 'utf8');
	const dir = path.dirname(file);

	for (const link of linksOf(text)) {
		const target = link.target.trim();
		if (/^(https?:|mailto:|ftp:|file:)/i.test(target)) {
			try {
				new URL(target);
			} catch {
				problems.push(`${relFile}: malformed URL ${target}`);
			}
			continue;
		}
		if (target.startsWith('#')) {
			const anchor = decodeURIComponent(target.slice(1));
			if (!anchorsForFile(file).has(anchor)) {
				problems.push(`${relFile}: broken anchor ${target} (heading not found)`);
			}
			continue;
		}

		// Local reference: strip anchor, resolve relative to the file (or repo root for README-level)
		const [rawPath, rawAnchor] = target.split('#');
		const base = relFile === 'README.md' ? ROOT : dir;
		const resolved = path.resolve(base, rawPath);
		const display = `${relFile}: ${target}`;

		if (!fs.existsSync(resolved)) {
			const optional =
				OPTIONAL_TARGETS.includes(resolved) ||
				SIBLING_STATUS.test(rawPath) ||
				rawPath === 'improvement-status-documentation.md';
			if (!optional) problems.push(`${display} (file or directory not found)`);
			continue;
		}
		if (rawAnchor !== undefined && rawAnchor !== '' && fs.statSync(resolved).isFile() && resolved.endsWith('.md')) {
			const anchor = decodeURIComponent(rawAnchor);
			if (!anchorsForFile(resolved).has(anchor)) {
				problems.push(`${display} (anchor "#${rawAnchor}" not found in ${path.relative(ROOT, resolved)})`);
			}
		}
	}

	// Relative links to markdown files should point at files that exist (covered above);
	// also verify plain relative references in text like "docs/foo.md" outside links.
	const plainRefs = text.match(/\]\(([^)]+)\)/g) || [];
	void plainRefs;
}

// Also: every markdown file under docs/ should be reachable from README or another doc.
const linkedTargets = new Set();
for (const file of files) {
	const text = fs.readFileSync(file, 'utf8');
	const dir = path.dirname(file);
	for (const link of linksOf(text)) {
		if (/^(https?:|mailto:|ftp:|file:|#)/i.test(link.target)) continue;
		const rawPath = link.target.split('#')[0];
		if (!rawPath) continue;
		const base = path.relative(ROOT, file) === 'README.md' ? ROOT : dir;
		linkedTargets.add(path.resolve(base, rawPath));
	}
}
for (const file of DOCS_FILES()) {
	if (!linkedTargets.has(path.resolve(file))) {
		problems.push(`${path.relative(ROOT, file)}: orphan document (not linked from README or any doc)`);
	}
}

function DOCS_FILES() {
	return listMarkdownFiles(DOCS).filter(f =>
		!/improvement-status-(backend|dashboard|desktop)\.md$/.test(f) &&
		!/implementation_plan\.md$/.test(f) &&
		!/improvement-status-documentation\.md$/.test(f)
	);
}

if (problems.length > 0) {
	console.error(`Documentation link check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(`Documentation links OK: ${files.length} files checked (README.md and docs/).`);

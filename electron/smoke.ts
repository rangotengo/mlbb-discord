import * as fs from 'fs';
import * as path from 'path';

/**
 * Installed-app smoke checks (guide 25 / 27).
 *
 * These inspect a built or unpacked directory. They do not launch Electron,
 * sign anything, or contact a live service. Signing is reported from the
 * builder config only — never claimed as verified without credentials.
 */

export interface SmokeIssue {
	check: string;
	severity: 'error' | 'warning';
	message: string;
	recovery: string;
}

export interface SmokeReport {
	ok: boolean;
	issues: SmokeIssue[];
}

export interface PackageShape {
	root: string;
	/** package.json main, default dist/electron/main.js */
	main?: string;
	expectUi?: boolean;
	expectBuilderConfig?: boolean;
}

function issue(check: string, message: string, recovery: string, severity: SmokeIssue['severity'] = 'error'): SmokeIssue {
	return { check, severity, message, recovery };
}

export function smokePackage(shape: PackageShape): SmokeReport {
	const issues: SmokeIssue[] = [];
	const mainRelative = shape.main || path.join('dist', 'electron', 'main.js');
	const mainPath = path.join(shape.root, mainRelative);
	if (!fs.existsSync(mainPath)) {
		issues.push(issue(
			'entry',
			`Packaged entry ${mainRelative} is missing.`,
			'Run npm run build and npm run electron:build before packaging.'
		));
	}

	const required = [
		path.join('dist', 'electron', 'preload.js'),
		path.join('dist', 'index.js'),
		path.join('ui', 'index.html'),
		path.join('ui', 'renderer.js')
	];
	if (shape.expectUi !== false) {
		for (const relative of required) {
			if (!fs.existsSync(path.join(shape.root, relative))) {
				issues.push(issue(
					'resource',
					`Required file ${relative} is missing from the package root.`,
					'Rebuild the desktop bundle. Do not delete dist while another owner is testing.'
				));
			}
		}
	}

	const builder = path.join(shape.root, 'electron-builder.yml');
	if (shape.expectBuilderConfig !== false && fs.existsSync(builder)) {
		const text = fs.readFileSync(builder, 'utf-8');
		if (!/asar:\s*false/.test(text)) {
			issues.push(issue('packaging', 'electron-builder.yml no longer sets asar: false.', 'Keep asar disabled until the SQL.js and extra resource layout is verified inside an asar archive.', 'warning'));
		}
		if (/forceCodeSigning:\s*true/.test(text) || /identity:\s*['"][^'"]+['"]/.test(text)) {
			issues.push(issue(
				'signing',
				'Builder config names a signing identity, but this environment has not verified a signed artefact.',
				'Remove the identity until signing credentials and a platform build exist, or document the credential blocker.',
				'warning'
			));
		}
	}

	const spaced = path.join(shape.root, 'path with spaces');
	if (fs.existsSync(mainPath)) {
		const contents = fs.readFileSync(mainPath, 'utf-8');
		if (contents.includes('app.getPath(') && !contents.includes('path.join')) {
			issues.push(issue('paths', 'Desktop entry uses app paths without path.join.', 'Join user-data paths so directories with spaces keep working.', 'warning'));
		}
		void spaced;
	}

	return { ok: issues.filter(item => item.severity === 'error').length === 0, issues };
}

export interface SigningStatus {
	configured: boolean;
	verified: false;
	blocker: string;
}

/** Signing is never reported as verified from config alone. */
export function signingStatus(builderYaml: string): SigningStatus {
	const configured = /forceCodeSigning:\s*true/.test(builderYaml)
		|| /CSC_LINK/.test(builderYaml)
		|| /identity:\s*['"]Developer ID/.test(builderYaml)
		|| /certificateFile:/.test(builderYaml);
	return {
		configured,
		verified: false,
		blocker: configured
			? 'Signing settings are present, but no signed installer was produced in this environment.'
			: 'No signing credentials or platform identity are configured. Windows SmartScreen and macOS Gatekeeper will warn. Do not describe installers as signed.'
	};
}

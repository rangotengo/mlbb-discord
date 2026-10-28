export function getIdParam(params: Record<string, string | string[]>, key = "id"): string {
	const value = params[key];
	return (Array.isArray(value) ? value[0] : value) ?? "";
}

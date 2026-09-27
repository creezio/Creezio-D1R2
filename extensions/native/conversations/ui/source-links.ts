/** Original Creezio assistant source labels, narrowed to declared internal routes. */
export type AssistantSource = Readonly<{title: string; url: string; type?: string}>;

export function sourceLinkMatchers(sources: readonly AssistantSource[] | undefined):
  {text: string; url: string; type?: string}[] {
  if (!sources?.length) return [];
  const out: {text: string; url: string; type?: string}[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const text = source.title.trim(), url = source.url;
    if (text.length < 2 || !url.startsWith('/') || url.startsWith('//')) continue;
    const key = `${text.toLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({text, url, type: source.type});
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

/**
 * Abbreviates a model engine name for compact UI display.
 *
 * Examples:
 *   "ollama:qwen2.5:3b"          -> "Qwen 2.5"
 *   "gemini-2.5-flash"           -> "Gemini 2.5"
 *   "gpt-4o"                     -> "GPT-4o"
 *   "claude-3.5-sonnet (Latest)" -> "Claude 3.5"
 */
export const formatShortModelName = (name: string): string => {
  if (!name) return 'Modelo';
  // Strip provider prefixes e.g. "ollama:qwen2.5:3b" or "google/"
  let clean = name.replace(/^(ollama|google|openai|anthropic|groq|openrouter):/i, '').trim();
  // Strip parenthetical text like "(3.1B)" or "(Offline)"
  clean = clean.replace(/\s*\([^)]*\)/g, '').trim();
  // Strip tags like ":latest" or ":3b" or ":8b"
  clean = clean.replace(/:[a-zA-Z0-9_.-]+/g, '').trim();

  // Handle GPT models specifically: "gpt-4o", "gpt-4.5-turbo", "gpt-4o-mini", "chatgpt-4o"
  const gptMatch = clean.match(/^(?:chat)?gpt[\s\-_]*(\d+(?:\.\d+)?(?:o)?)/i);
  if (gptMatch) {
    return `GPT-${gptMatch[1]}`;
  }

  // Match model name followed by version numbers e.g. "gemini 2.5", "claude-3.5", "qwen2.5", "llama3.2", "deepseek-r1"
  const matchWithVersion = clean.match(/^([A-Za-z]+)[\s\-_]*([vr])?(\d+(?:\.\d+)?)/i);
  if (matchWithVersion) {
    const brand = matchWithVersion[1];
    const formattedBrand = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const prefix = matchWithVersion[2] ? matchWithVersion[2].toUpperCase() : '';
    const version = matchWithVersion[3];
    return prefix ? `${formattedBrand} ${prefix}${version}` : `${formattedBrand} ${version}`;
  }

  // Fallback: take first two words or first 14 chars
  const words = clean.split(/[\s\-_]+/);
  if (words.length >= 2) {
    return `${words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase()} ${words[1]}`;
  }
  return clean.slice(0, 14);
};

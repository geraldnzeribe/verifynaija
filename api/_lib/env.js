// Read an environment variable with stray whitespace and quotes removed.
// (Values pasted into dashboards or piped through `echo` often pick up a leading space or newline.)
export const env = (name, fallback = undefined) => {
  const v = process.env[name];
  if (v == null) return fallback;
  const t = v.trim().replace(/^["']|["']$/g, '').trim();
  return t === '' ? fallback : t;
};

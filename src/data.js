// Entity data loading. Each data file is fetched once per session and reused
// across entity switches and the landing page's card stats. The cached value
// is the fetch promise, so concurrent consumers share one request; a failure
// evicts itself so a retry can succeed.
const dataCache = new Map();

export function fetchData(file) {
  if (!dataCache.has(file)) {
    dataCache.set(file, fetch(import.meta.env.BASE_URL + file)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .catch((e) => { dataCache.delete(file); throw e; }));
  }
  return dataCache.get(file);
}

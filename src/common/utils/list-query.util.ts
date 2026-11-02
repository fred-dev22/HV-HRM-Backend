// Contrat commun des listes paginees cote serveur : meme parametres, meme
// forme de reponse partout ({ items, total, ... }). La recherche, les filtres
// et le tri s'appliquent a TOUTES les donnees en base, pas a une page deja
// chargee.
export interface ListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  dir: 'asc' | 'desc';
}

export interface Page<T, M = Record<string, never>> {
  items: T[];
  total: number;
  meta?: M;
}

const MAX_PAGE_SIZE = 100;

export function parseListQuery(raw: {
  page?: string;
  pageSize?: string;
  search?: string;
  sort?: string;
  dir?: string;
}): ListQuery {
  const page = Math.max(1, Number.parseInt(raw.page ?? '1', 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(raw.pageSize ?? '10', 10) || 10));
  const search = raw.search?.trim() || undefined;
  return { page, pageSize, search, sort: raw.sort || undefined, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
}

export function pageWindow(q: ListQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

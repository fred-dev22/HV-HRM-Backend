import { pageWindow, parseListQuery } from './list-query.util';

describe('parseListQuery', () => {
  it('applique les valeurs par defaut', () => {
    expect(parseListQuery({})).toEqual({ page: 1, pageSize: 10, search: undefined, sort: undefined, dir: 'asc' });
  });

  it('borne la page et la taille de page', () => {
    const q = parseListQuery({ page: '-3', pageSize: '100000' });
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(100);
    expect(parseListQuery({ pageSize: '0' }).pageSize).toBe(10);
    expect(parseListQuery({ page: 'abc', pageSize: 'xyz' })).toMatchObject({ page: 1, pageSize: 10 });
  });

  it('nettoie la recherche et le sens du tri', () => {
    const q = parseListQuery({ search: '  dupont  ', dir: 'desc', sort: 'employee' });
    expect(q).toMatchObject({ search: 'dupont', dir: 'desc', sort: 'employee' });
    expect(parseListQuery({ search: '   ' }).search).toBeUndefined();
    expect(parseListQuery({ dir: 'n-importe-quoi' }).dir).toBe('asc');
  });
});

describe('pageWindow', () => {
  it('calcule le decalage de la page', () => {
    expect(pageWindow(parseListQuery({ page: '3', pageSize: '25' }))).toEqual({ skip: 50, take: 25 });
    expect(pageWindow(parseListQuery({}))).toEqual({ skip: 0, take: 10 });
  });
});

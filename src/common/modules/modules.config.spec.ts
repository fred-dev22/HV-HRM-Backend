import { DEFAULT_ENABLED_MODULES, getEnabledModules, isModuleEnabled, moduleOfPermission } from './modules.config';

describe('modules actifs (brand/client.json)', () => {
  it('sans fichier ni liste : application generique, aucun module optionnel', () => {
    expect(getEnabledModules({})).toEqual(DEFAULT_ENABLED_MODULES);
    expect(getEnabledModules({})).toEqual([]);
  });

  it('liste explicite : seuls les modules cites sont actifs', () => {
    expect(getEnabledModules({ modules: ['training'] })).toEqual(['training']);
    expect(isModuleEnabled('recruitment', { modules: ['training'] })).toBe(false);
    expect(isModuleEnabled('training', { modules: ['training'] })).toBe(true);
  });

  it('liste vide : aucun module optionnel', () => {
    expect(getEnabledModules({ modules: [] })).toEqual([]);
    expect(getEnabledModules({ modules: [' ', ''] })).toEqual([]);
  });

  it('tolere la casse, les espaces et les doublons', () => {
    expect(getEnabledModules({ modules: [' Recruitment ', 'TRAINING', 'training'] })).toEqual(['recruitment', 'training']);
  });

  it('ignore un nom inconnu sans activer autre chose', () => {
    expect(getEnabledModules({ modules: ['recrutement', 'training'] })).toEqual(['training']);
  });

  it("une valeur qui n'est pas une liste est ignoree", () => {
    expect(getEnabledModules({ modules: 'training' as never })).toEqual([]);
  });

  it('active tous les modules quand on les cite tous', () => {
    expect(getEnabledModules({ modules: ['missions_expenses', 'recruitment', 'training', 'payroll', 'reports'] })).toHaveLength(5);
  });

  it('rattache les permissions a leur module', () => {
    expect(moduleOfPermission('MISSION_VALIDER')).toBe('missions_expenses');
    expect(moduleOfPermission('FRAIS_VOIR_TOUT')).toBe('missions_expenses');
    expect(moduleOfPermission('CONFIG_FRAIS_MISSION')).toBe('missions_expenses');
    expect(moduleOfPermission('RECRUTEMENT_ACCES')).toBe('recruitment');
    expect(moduleOfPermission('RECRUTEMENT_BESOIN_EXPRIMER')).toBe('recruitment');
    expect(moduleOfPermission('FORMATION_ACCES')).toBe('training');
    // socle : jamais coupe
    expect(moduleOfPermission('CONGE_VALIDER')).toBeNull();
    expect(moduleOfPermission('EMPLOYE_VOIR_TOUT')).toBeNull();
  });
});

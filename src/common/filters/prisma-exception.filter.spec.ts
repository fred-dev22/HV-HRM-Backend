import {
  extractConflictingFields,
  buildConflictMessage,
} from './prisma-exception.filter';

describe('extractConflictingFields', () => {
  it('returns [] when meta is undefined', () => {
    expect(extractConflictingFields(undefined)).toEqual([]);
  });

  it('reads meta.target when it is an array (standard Prisma shape)', () => {
    expect(extractConflictingFields({ target: ['Code'] })).toEqual(['Code']);
  });

  it('reads meta.target when it is a string', () => {
    expect(extractConflictingFields({ target: 'Email' })).toEqual(['Email']);
  });

  it('falls back to parsing the constraint index name (SQL Server shape)', () => {
    expect(
      extractConflictingFields({
        constraint: { index: 'OrganizationUnit_Code_key' },
      }),
    ).toEqual(['Code']);
  });

  it('parses composite constraint index names into every field', () => {
    expect(
      extractConflictingFields({
        constraint: { index: 'CalendarWorkDay_CalendarId_DayOfWeek_key' },
      }),
    ).toEqual(['CalendarId', 'DayOfWeek']);
    expect(
      extractConflictingFields({
        constraint: {
          index:
            'ExpenseConfig_EmployeeCategoryId_ExpenseTypeId_MissionCategory_key',
        },
      }),
    ).toEqual(['EmployeeCategoryId', 'ExpenseTypeId', 'MissionCategory']);
  });

  it('returns [] when neither target nor a recognizable constraint is present', () => {
    expect(extractConflictingFields({})).toEqual([]);
    expect(
      extractConflictingFields({
        constraint: { index: 'not_the_expected_shape' },
      }),
    ).toEqual([]);
  });
});

describe('buildConflictMessage', () => {
  it('produces a generic message when no field could be identified', () => {
    expect(buildConflictMessage([], undefined)).toBe(
      'Cette valeur est déjà utilisée.',
    );
  });

  it.each([
    ['Code', { Code: 'DIR-01' }, 'Le code "DIR-01" est déjà utilisé.'],
    ['Email', { Email: 'a@b.com' }, 'L\'email "a@b.com" est déjà utilisé.'],
    [
      'Username',
      { Username: 'jdupont' },
      'Le nom d\'utilisateur "jdupont" est déjà utilisé.',
    ],
    [
      'EmployeeNumber',
      { EmployeeNumber: 'EMP-042' },
      'Le matricule "EMP-042" est déjà utilisé.',
    ],
    [
      'ReferenceCode',
      { ReferenceCode: 'LR-2026-001' },
      'Le code de référence "LR-2026-001" est déjà utilisé.',
    ],
  ])(
    'builds a French message identifying %s from the request body',
    (field, body, expected) => {
      expect(buildConflictMessage([field], body)).toBe(expected);
    },
  );

  it('omits the value when it is absent from the body but still names the field', () => {
    expect(buildConflictMessage(['Code'], undefined)).toBe(
      'Le code est déjà utilisé.',
    );
    expect(buildConflictMessage(['Code'], {})).toBe(
      'Le code est déjà utilisé.',
    );
  });

  it('falls back to a generic field label for unknown fields', () => {
    expect(
      buildConflictMessage(['SomeUnmappedField'], { SomeUnmappedField: 'x' }),
    ).toBe(
      'Le champ "SomeUnmappedField" a la valeur "x" qui est déjà utilisée.',
    );
    expect(buildConflictMessage(['SomeUnmappedField'], undefined)).toBe(
      'Le champ "SomeUnmappedField" est déjà utilisé.',
    );
  });

  it('describes composite unique constraints as a combination', () => {
    expect(buildConflictMessage(['CalendarId', 'DayOfWeek'], {})).toBe(
      'Cette combinaison (calendrier, jour de la semaine) existe déjà.',
    );
  });
});

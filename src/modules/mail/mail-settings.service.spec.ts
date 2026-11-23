import { BadRequestException } from '@nestjs/common';
import { MailSettingsService } from './mail-settings.service';
import { MailService } from './mail.service';
import { decryptSecret, encryptSecret } from './mail-secret.util';


function build(row: any = null) {
  const store = { row };
  const prisma = {
    mailSettings: {
      findFirst: jest.fn(async () => store.row),
      create: jest.fn(async ({ data }: any) => (store.row = { Id: 'm1', SmtpSecure: false, ...data })),
      update: jest.fn(async ({ data }: any) => (store.row = { ...store.row, ...data })),
    },
  };
  return { service: new MailSettingsService(prisma as any), prisma, store };
}

describe('MailSettingsService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'secret-de-test';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('chiffre puis dechiffre un secret, et refuse une valeur alteree', () => {
    const enc = encryptSecret('mot-de-passe');
    expect(enc).not.toContain('mot-de-passe');
    expect(decryptSecret(enc)).toBe('mot-de-passe');
    expect(decryptSecret(enc.slice(0, -4) + 'AAAA')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it('rien en base ni en environnement : non configure', async () => {
    const { service } = build();
    expect(await service.isConfigured()).toBe(false);
    expect((await service.resolve()).source).toBe('none');
  });

  it("les variables GRAPH_MAIL_* du .env ne sont plus utilisees : non configure et aucun envoi", async () => {
    process.env.GRAPH_MAIL_SENDER = 'noreply@x.mg';
    process.env.GRAPH_MAIL_TENANT_ID = 't';
    process.env.GRAPH_MAIL_CLIENT_ID = 'c';
    process.env.GRAPH_MAIL_CLIENT_SECRET = 's';
    const { service } = build();
    expect(await service.isConfigured()).toBe(false);
    expect((await service.resolve()).source).toBe('none');
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const r = await new MailService(service).sendDetailed({ to: 'x@y.mg', subject: 's', html: '<p/>' });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('enregistre un SMTP, chiffre le mot de passe et ne le renvoie jamais', async () => {
    const { service, store } = build();
    const view = await service.save(
      { provider: 'Smtp', sender: 'rh@client.mg', smtpHost: 'smtp.client.mg', smtpPort: 587, smtpUser: 'rh', smtpPassword: 'pw' },
      'emp1',
    );
    expect(store.row.SmtpPasswordEnc).toBeTruthy();
    expect(store.row.SmtpPasswordEnc).not.toBe('pw');
    expect(JSON.stringify(view)).not.toContain('pw"');
    expect(view.smtp.hasPassword).toBe(true);
    expect(view.configured).toBe(true);
    expect(view.source).toBe('database');
  });

  it('un mot de passe laisse vide conserve celui deja enregistre', async () => {
    const { service, store } = build();
    await service.save({ provider: 'Smtp', sender: 'rh@client.mg', smtpHost: 'h', smtpPort: 25, smtpUser: 'u', smtpPassword: 'pw' }, 'e');
    const before = store.row.SmtpPasswordEnc;
    await service.save({ provider: 'Smtp', sender: 'rh@client.mg', smtpHost: 'h2', smtpPort: 25, smtpUser: 'u' }, 'e');
    expect(store.row.SmtpPasswordEnc).toBe(before);
    expect(store.row.SmtpHost).toBe('h2');
  });

  it('refuse un Graph incomplet avec un message clair', async () => {
    const { service } = build();
    await expect(service.save({ provider: 'Graph', sender: 'a@b.mg', graphTenantId: 't' }, 'e')).rejects.toThrow(BadRequestException);
    await expect(service.save({ provider: 'Graph', sender: 'a@b.mg', graphTenantId: 't', graphClientId: 'c' }, 'e')).rejects.toThrow(/secret/);
  });

  it('refuse un SMTP sans serveur', async () => {
    const { service } = build();
    await expect(service.save({ provider: 'Smtp', sender: 'a@b.mg' }, 'e')).rejects.toThrow(/serveur SMTP/);
  });

  it('un secret illisible (cle changee) rend la configuration incomplete', async () => {
    const { service, store } = build();
    await service.save({ provider: 'Graph', sender: 'a@b.mg', graphTenantId: 't', graphClientId: 'c', graphClientSecret: 's' }, 'e');
    process.env.JWT_SECRET = 'autre-cle';
    (service as any).cache = null;
    expect(store.row.GraphClientSecretEnc).toBeTruthy();
    expect(await service.isConfigured()).toBe(false);
  });

  it("MailService.sendDetailed explique l'absence de configuration au lieu de planter", async () => {
    const { service } = build();
    const mail = new MailService(service);
    const r = await mail.sendDetailed({ to: 'x@y.mg', subject: 's', html: '<p/>' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pas configuré/);
    expect(await mail.send({ to: 'x@y.mg', subject: 's', html: '<p/>' })).toBe(false);
  });
});

describe('MailService : mode SMTP', () => {
  it("envoie via nodemailer avec l'expediteur, l'authentification et les pieces jointes", async () => {
    const nodemailer = require('nodemailer');
    const sendMail = jest.fn().mockResolvedValue({});
    const close = jest.fn();
    const spy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail, close } as any);
    const settings = {
      resolve: async () => ({
        source: 'database',
        config: { provider: 'Smtp', sender: 'rh@client.mg', host: 'smtp.client.mg', port: 465, secure: true, user: 'rh', password: 'pw' },
      }),
    };
    const ok = await new MailService(settings as any).send({
      to: 'a@b.mg', subject: 'S', html: '<p>x</p>',
      attachments: [{ name: 'f.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' }],
    });
    expect(ok).toBe(true);
    expect(spy.mock.calls[0]![0]).toMatchObject({ host: 'smtp.client.mg', port: 465, secure: true, auth: { user: 'rh', pass: 'pw' } });
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: 'rh@client.mg', to: 'a@b.mg',
      attachments: [{ filename: 'f.pdf', content: 'QUJD', encoding: 'base64' }],
    });
    expect(close).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("un echec SMTP ne leve pas : renvoie false et la raison", async () => {
    const nodemailer = require('nodemailer');
    const spy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('535 Authentication failed')),
      close: jest.fn(),
    } as any);
    const settings = {
      resolve: async () => ({ source: 'database', config: { provider: 'Smtp', sender: 'a@b.mg', host: 'h', port: 25, secure: false, user: null, password: null } }),
    };
    const r = await new MailService(settings as any).sendDetailed({ to: 'a@b.mg', subject: 'S', html: '' });
    expect(r).toEqual({ ok: false, error: '535 Authentication failed' });
    spy.mockRestore();
  });
});

describe('MailSettingsService : table absente', () => {
  it("traite une table absente comme non configure, sans lever d'erreur", async () => {
    const prisma = { mailSettings: { findFirst: jest.fn().mockRejectedValue(new Error("Invalid object name 'MailSettings'")) } };
    const service = new MailSettingsService(prisma as any);
    expect(await service.isConfigured()).toBe(false);
    const r = await new MailService(service).sendDetailed({ to: 'x@y.mg', subject: 's', html: '<p/>' });
    expect(r.ok).toBe(false);
  });
});

describe('MailSettingsService : identifiants chiffres et masques', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'secret-de-test';
  });

  it("chiffre tenant, client et secret en base, et ne renvoie que des indices", async () => {
    const { service, store } = build();
    const view = await service.save(
      { provider: 'Graph', sender: 'a@b.mg', graphTenantId: '7b89570b-ddea-462f-85fb-ae212d49c059', graphClientId: '5d284a79-5aba-46cc-8a24-ab9190d28e01', graphClientSecret: 'Sup3rSecret~value' },
      'e',
    );
    const stored = JSON.stringify(store.row);
    expect(stored).not.toContain('7b89570b');
    expect(stored).not.toContain('5d284a79');
    expect(stored).not.toContain('Sup3rSecret');
    const shown = JSON.stringify(view);
    expect(shown).not.toContain('7b89570b');
    expect(shown).not.toContain('Sup3rSecret');
    expect(view.graph).toMatchObject({ hasTenantId: true, hasClientId: true, hasSecret: true, tenantIdHint: '••••c059', clientIdHint: '••••8e01' });
    expect(await service.isConfigured()).toBe(true);
  });

  it("modifier un seul champ conserve les autres identifiants", async () => {
    const { service, store } = build();
    await service.save({ provider: 'Graph', sender: 'a@b.mg', graphTenantId: 'tenant-aaaa-1111', graphClientId: 'client-bbbb-2222', graphClientSecret: 'secret-1' }, 'e');
    const tenantBefore = store.row.GraphTenantIdEnc;
    const secretBefore = store.row.GraphClientSecretEnc;
    await service.save({ provider: 'Graph', sender: 'a@b.mg', graphClientId: 'client-NEW-9999' }, 'e');
    expect(store.row.GraphTenantIdEnc).toBe(tenantBefore);
    expect(store.row.GraphClientSecretEnc).toBe(secretBefore);
    const view = await service.getAdminView();
    expect(view.graph.clientIdHint).toBe('••••9999');
  });

  it("SMTP : l'identifiant est chiffre ; decocher l'authentification efface identifiant et mot de passe", async () => {
    const { service, store } = build();
    await service.save({ provider: 'Smtp', sender: 'rh@c.mg', smtpHost: 'h', smtpPort: 587, smtpUser: 'compte@c.mg', smtpPassword: 'pw' }, 'e');
    expect(JSON.stringify(store.row)).not.toContain('compte@c.mg');
    await service.save({ provider: 'Smtp', sender: 'rh@c.mg', smtpHost: 'h', smtpPort: 25, smtpAuth: false }, 'e');
    expect(store.row.SmtpUserEnc).toBeNull();
    expect(store.row.SmtpPasswordEnc).toBeNull();
    expect(await service.isConfigured()).toBe(true);
  });
});

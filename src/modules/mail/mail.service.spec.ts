import { MailService } from './mail.service';

// Format de la requete envoyee a Microsoft Graph pour les pieces jointes.
describe('MailService.send : pieces jointes', () => {
  const realFetch = globalThis.fetch;
  let sendMailBody: any;
  // Configuration Graph telle que l'ecran de configuration l'enregistre.
  const settings: any = {
    resolve: async () => ({
      source: 'database',
      config: { provider: 'Graph', sender: 'noreply@test.mg', tenantId: 't', clientId: 'c', clientSecret: 's' },
    }),
  };

  beforeEach(() => {
    sendMailBody = undefined;
    globalThis.fetch = jest.fn(async (url: any, init: any) => {
      if (String(url).includes('login.microsoftonline.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      sendMailBody = JSON.parse(init.body);
      return new Response(null, { status: 202 });
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('envoie chaque fichier en fileAttachment avec son contenu base64', async () => {
    const ok = await new MailService(settings).send({
      to: 'val@test.mg', subject: 'Sujet', html: '<p>x</p>',
      attachments: [{ name: 'certificat.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' }],
    });
    expect(ok).toBe(true);
    expect(sendMailBody.message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'certificat.pdf',
        contentType: 'application/pdf',
        contentBytes: 'QUJD',
      },
    ]);
  });

  it('sans piece jointe, la requete est inchangee (aucune cle attachments)', async () => {
    await new MailService(settings).send({ to: 'val@test.mg', subject: 'Sujet', html: '<p>x</p>' });
    expect('attachments' in sendMailBody.message).toBe(false);
    await new MailService(settings).send({ to: 'val@test.mg', subject: 'Sujet', html: '<p>x</p>', attachments: [] });
    expect('attachments' in sendMailBody.message).toBe(false);
  });
});

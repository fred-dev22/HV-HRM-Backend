import { MailService } from './mail.service';

// Format de la requete envoyee a Microsoft Graph pour les pieces jointes.
describe('MailService.send : pieces jointes', () => {
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  let sendMailBody: any;

  beforeEach(() => {
    process.env.GRAPH_MAIL_SENDER = 'noreply@test.mg';
    process.env.GRAPH_MAIL_TENANT_ID = 't';
    process.env.GRAPH_MAIL_CLIENT_ID = 'c';
    process.env.GRAPH_MAIL_CLIENT_SECRET = 's';
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
    process.env = { ...env };
  });

  it('envoie chaque fichier en fileAttachment avec son contenu base64', async () => {
    const ok = await new MailService().send({
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
    await new MailService().send({ to: 'val@test.mg', subject: 'Sujet', html: '<p>x</p>' });
    expect('attachments' in sendMailBody.message).toBe(false);
    await new MailService().send({ to: 'val@test.mg', subject: 'Sujet', html: '<p>x</p>', attachments: [] });
    expect('attachments' in sendMailBody.message).toBe(false);
  });
});

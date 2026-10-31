// E-mail (GAPS.md "E-post", decided on 2026-10-31): an invite sent to the person, and a new invite for
// someone who lost every way in. Sent through Resend (https://resend.com/docs/api-reference/emails/send-email),
// whose sender domain must be verified there; a server without a key sends none and says so (`AuthState.mail`).

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * What sending needs: the mailer, and the app's own address for the links. The address is configured, never
 * taken from a request, so a forged Host header cannot put its own site in a link with a real invite in it.
 */
export interface MailConfig {
  mailer: Mailer;
  appUrl: string;
}

/**
 * Sends through Resend's API with `apiKey`, from `from` ("Gospel Presenter <noreply@example.org>"). `endpoint` is
 * Resend's unless a test gives a fake one.
 */
export function resendMailer(opts: { apiKey: string; from: string; endpoint?: string; fetch?: typeof fetch }): Mailer {
  const send = opts.fetch ?? fetch;
  return {
    async send(mail) {
      const res = await send(opts.endpoint ?? 'https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${await res.text()}`);
    },
  };
}

/** The mail config from the settings a host reads, or null when one of them is missing. */
export function mailConfigFrom(s: { apiKey?: string; from?: string; appUrl?: string; endpoint?: string }): MailConfig | null {
  if (!s.apiKey || !s.from || !s.appUrl) return null;
  return { mailer: resendMailer({ apiKey: s.apiKey, from: s.from, endpoint: s.endpoint || undefined }), appUrl: s.appUrl };
}

/** An invite's page, as the app's own link has it (`/invite#{token}`: the token stays out of every server's log). */
export const inviteLink = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, '')}/invite#${encodeURIComponent(token)}`;

/** The mail with an invite: from an admin (`invite`), or asked for on the sign-in page (`recovery`). */
export function inviteMail(kind: 'invite' | 'recovery', a: { to: string; name: string; orgName: string; link: string }): Mail {
  const days = 'Länken gäller i 7 dagar och kan användas en gång.';
  if (kind === 'invite')
    return {
      to: a.to,
      subject: `Du är inbjuden till ${a.orgName} i Gospel Presenter`,
      text: [`Hej ${a.name}!`, '', `Du är inbjuden till ${a.orgName} i Gospel Presenter. Öppna länken och logga in med Google eller skapa en passkey:`, '', a.link, '', days].join('\n'),
    };
  return {
    to: a.to,
    subject: 'Logga in i Gospel Presenter igen',
    text: [
      `Hej ${a.name}!`,
      '',
      `Någon bad om ett nytt sätt att logga in i ${a.orgName} i Gospel Presenter med din e-postadress. Öppna länken och logga in med Google eller skapa en passkey:`,
      '',
      a.link,
      '',
      days,
      'Bad du inte om det här kan du strunta i mejlet: inget ändras förrän länken används.',
    ].join('\n'),
  };
}

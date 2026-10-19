import nodemailer from 'nodemailer'
import type { Config } from '../config'
import type { Logger } from './logger'

export type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string }
export interface Mailer {
  configured: boolean
  send(mail: Mail): Promise<void>
}

// Reserved, undeliverable domains (RFC 2606/6761): demo users and the invented demo firm's clients
// use them, so background jobs can never email anyone on their behalf.
const RESERVED = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|[^@]*\.invalid|[^@]*\.test|[^@]*\.example|[^@]*\.localhost)$/i
export const isReservedAddress = (to: string) => RESERVED.test(to.trim())

export function createMailer(config: Config, log: Logger): Mailer {
  const inner = createTransportMailer(config, log)
  return {
    configured: inner.configured,
    async send(mail) {
      if (isReservedAddress(mail.to)) return log.info('email skipped: reserved address', { subject: mail.subject })
      return inner.send(mail)
    }
  }
}

function createTransportMailer(config: Config, log: Logger): Mailer {
  if (!config.smtp) {
    return {
      configured: false,
      async send(mail) {
        // Without SMTP the message is logged so local development still works end to end.
        if (config.isProduction) log.warn('email not sent: SMTP is not configured', { to: mail.to, subject: mail.subject })
        else log.info('email (dev, not sent)', { to: mail.to, subject: mail.subject, text: mail.text })
      }
    }
  }
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
  })
  return {
    configured: true,
    async send(mail) {
      try {
        await transport.sendMail({ from: config.mailFrom, ...mail })
      } catch (err) {
        log.error('email send failed', { to: mail.to, subject: mail.subject, err })
        throw err
      }
    }
  }
}

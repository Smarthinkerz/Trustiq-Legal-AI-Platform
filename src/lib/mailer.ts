import nodemailer from 'nodemailer'
import type { Config } from '../config'
import type { Logger } from './logger'

export type Mail = { to: string; subject: string; text: string; html?: string }
export interface Mailer {
  configured: boolean
  send(mail: Mail): Promise<void>
}

export function createMailer(config: Config, log: Logger): Mailer {
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

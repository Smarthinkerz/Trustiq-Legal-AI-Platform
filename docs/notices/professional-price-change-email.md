# Draft for review: Professional price change notice

Status: DRAFT, not sent. Sending is switched off (`PRICE_NOTICE_EMAILS=off`). When approved, set `PRICE_NOTICE_EMAILS=on` in Railway; each affected firm's owners and admins then receive it once, 30 days before their locked price ends (around September 16, 2027). Replies go to the sales email.

Who receives it: firms that were on Professional when the grandfathered price was applied (locked at OMR 499 until October 16, 2027) and are still on Professional.

Example values below: firm "Al Noor Advocates", admin "Salim".

## English

Subject: A change to your TrustiqLegal Professional price

Hello Salim,

Thank you for being a TrustiqLegal customer. When the Professional plan price went up, we kept Al Noor Advocates at OMR 499 a month for twelve months.

That period ends on 2027-10-15. From your first renewal after that date, the price will be OMR 649 a month (excluding VAT). Your features and limits stay the same.

You do not need to do anything. If you have questions or would like to discuss your options, just reply to this email.

(link to Settings > Plan & usage)

The TrustiqLegal team

## Arabic (sent to users whose language is Arabic)

الموضوع: تغيير سعر باقة TrustiqLegal الاحترافية

مرحباً Salim،

شكراً لثقتكم بنا. عند رفع سعر الباقة الاحترافية أبقينا سعر Al Noor Advocates عند 499 OMR شهرياً لمدة اثني عشر شهراً.

تنتهي هذه الفترة في 2027-10-15. ابتداءً من أول تجديد بعد هذا التاريخ يصبح السعر 649 OMR شهرياً (لا يشمل ضريبة القيمة المضافة). لا تغيير في الميزات أو الحدود.

لا يلزمكم القيام بأي إجراء. إذا كانت لديكم أي أسئلة أو رغبتم في مناقشة الخيارات المتاحة، فقط ردوا على هذه الرسالة.

(رابط الإعدادات > الباقة والاستخدام)

فريق TrustiqLegal

## Points to check

- The date shown, 2027-10-15, is the last day at OMR 499. Renewals from October 16, 2027 (Muscat time) charge OMR 649.
- Do you want a lawyer to confirm the 30 days notice is enough under your Terms?
- The wording is in `src/services/price-lock.ts` (`priceNoticeEmail`); changes there change the email.

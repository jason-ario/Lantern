// Legal documents (shared by the server, for acceptance versions, and the UI).
// DRAFTS: written as a starting point for launch. Have a lawyer review them and
// fill in the [bracketed] details before taking real payments.
// Bump a version whenever its text changes materially; the server records which
// version each player / creator accepted.
export const LEGAL_VERSIONS = { terms: '2026-09-29', privacy: '2026-09-29', creators: '2026-09-29', refunds: '2026-09-29' };

const CO = '[Company legal name]';
const ADDR = '[Registered address]';
const LAW = '[Governing law / courts]';
const MAIL = 'support@vibe-games.com';

export const LEGAL_DOCS = {
  terms: {
    title: 'Terms of Service',
    summary: 'The rules for using Vibe-Games as a player: your account, what buying a game means, and what we each promise.',
    sections: [
      ['Who we are', `Vibe-Games (vibe-games.com) is operated by ${CO}, ${ADDR} (“we”, “us”). By creating an account or buying a game you agree to these terms and to our <a href="/legal/privacy" data-link>Privacy Policy</a> and <a href="/legal/refunds" data-link>Refund Policy</a>.`],
      ['Your account', 'You can browse and try demos without an account; buying games and writing reviews need one. Keep your password safe: you are responsible for activity on your account. You must be at least 13 years old (or the minimum age in your country) to create an account, and have a parent or guardian’s permission if you are under 18.'],
      ['Buying games', 'Games on Vibe-Games are made by independent creators and sold by us on their behalf. When you buy a game you get a personal, non-transferable licence to play it for as long as Vibe-Games offers it, in any browser where you’re signed in and offline on your own devices. You don’t buy the game’s copyright. Prices include or exclude tax as shown at checkout.'],
      ['If a game is removed', 'Games you bought stay in your library even if a creator stops selling them or we remove them from the store, unless we must remove them for legal or safety reasons (for example malware or copyright infringement). If that happens soon after you bought it, we’ll refund you.'],
      ['Refunds', 'See the <a href="/legal/refunds" data-link>Refund Policy</a>. Nothing in these terms limits rights you have under the consumer law of your country.'],
      ['Reviews and your content', 'You keep ownership of reviews and other content you post, and give us a worldwide, royalty-free licence to show it on Vibe-Games and in promotion of the store. Reviews must be honest and about the game. We may remove content that breaks these rules.'],
      ['Rules', 'Don’t cheat the store or other players: no fake reviews, no manipulating rankings with fake accounts, no attacking, scraping or reverse-engineering the platform, no using it for anything illegal. We can suspend accounts that break these rules.'],
      ['Games are made by creators', 'Each game is the creator’s work and responsibility. We review games before they go live, but we can’t guarantee every game works on every device or is free of bugs. Games run in a sandbox that can’t access your account, other games or your files.'],
      ['Our liability', `Vibe-Games is provided “as is”. To the extent the law allows, we aren’t liable for indirect or consequential losses, and our total liability to you is limited to the amount you paid us in the 12 months before the claim. This doesn’t limit liability that can’t be limited by law.`],
      ['Changes and ending', 'We may update these terms; if the change is significant we’ll tell you by email or on the site before it applies. You can close your account at any time by contacting us. We may close accounts that seriously or repeatedly break these terms.'],
      ['Law and contact', `These terms are governed by ${LAW}, without taking away protections of the consumer law where you live. Questions: <a href="mailto:${MAIL}">${MAIL}</a>.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    summary: 'What we collect, why, who helps us run the store, and your rights.',
    sections: [
      ['Who is responsible', `${CO}, ${ADDR}, is the controller of your personal data. Contact: <a href="mailto:${MAIL}">${MAIL}</a>.`],
      ['What we collect', '<b>Account:</b> email, display name, password (stored only as a secure hash) or your Google account id. <b>Purchases:</b> what you bought, when, and the amount; card details go straight to Stripe and never reach us. <b>Play data:</b> playtime, cloud saves, achievements and basic launch health (whether a game started, error counts). <b>Technical:</b> a session cookie, and a salted hash of your IP address used to prevent ranking abuse. <b>Creators:</b> payout details are collected and held by Stripe.'],
      ['Why we use it', 'To run your account and library, sell and deliver games, keep your saves in sync, rank games by how people play them, prevent fraud and abuse, send you receipts and account emails, and fix errors. The legal bases are performing our contract with you, our legitimate interests in running a safe store, and legal obligations (for example tax records).'],
      ['What games can see', 'Games never see your email or account id. Each game gets a pseudonymous player id that is different in every game, plus your display name.'],
      ['Who helps us', 'Stripe (payments and creator payouts), Resend (email), Render (hosting and database), Cloudflare or another S3-compatible provider (file storage and backups), Sentry (error reports), and Google (if you use Google sign-in). They process data only on our instructions. Some are in the US; transfers use standard contractual clauses or equivalent safeguards.'],
      ['Cookies', 'We use one essential cookie to keep you signed in. We don’t use advertising or cross-site tracking cookies. The site also stores data in your browser (for example downloaded games) so it works offline.'],
      ['How long we keep it', 'Account data for as long as your account exists. Purchase records for as long as tax law requires (typically 6–10 years). Error reports for 90 days. Email logs for 30 days.'],
      ['Your rights', 'You can access, correct, export or delete your data, object to some uses, and complain to your data protection authority. Email us to use these rights; we’ll answer within 30 days. Deleting your account removes your library access.'],
      ['Children', 'Vibe-Games isn’t directed at children under 13, and we don’t knowingly collect their data.'],
      ['Changes', 'We’ll post changes here and tell you by email if they’re significant.'],
    ],
  },
  creators: {
    title: 'Creator Agreement',
    summary: 'The deal for selling your vibe-coded games on Vibe-Games: licence, revenue share, payouts and content rules.',
    sections: [
      ['The parties', `This agreement is between you (the “creator”) and ${CO} (“Vibe-Games”). You accept it when you join as a creator. You must be at least 18 and able to enter contracts.`],
      ['What you give us', 'For each game you publish, you give Vibe-Games a non-exclusive, worldwide licence to host, distribute, sell, display and promote it (including its name, art and screenshots), and to let players who bought it keep playing it, including after you stop selling it. You keep all ownership. You can sell your game elsewhere too.'],
      ['What you promise', 'You own or have the rights to everything in your game, including code, art, music and text, and including anything generated with AI tools: you’ve followed those tools’ terms and the output doesn’t copy someone else’s protected work. Your game contains no malware, tracking or hidden network calls, doesn’t break the law, and matches its store page. The “built with” tools and vibe details you list are accurate.'],
      ['Review and removal', 'We review every game and update before it goes live, and we may reject or remove games that break this agreement, our content rules or the law, or that are reported and found to be harmful. We’ll tell you why, except where the law or safety prevents it.'],
      ['Revenue share', 'You set the price. For each sale you receive <b>90% of net revenue</b>: the price paid minus sales tax/VAT and payment processing fees. Vibe-Games keeps the remaining 10%. Free games earn nothing and cost nothing.'],
      ['Payouts', 'Payouts are made through Stripe Connect. You must complete Stripe’s onboarding (identity and bank details). Your share of each sale is sent after the payment succeeds; earnings made before your payout account is ready are held and sent once it is. You’re responsible for your own income taxes.'],
      ['Refunds and chargebacks', 'If a sale is refunded under our <a href="/legal/refunds" data-link>Refund Policy</a> or charged back, your share of that sale is reversed.'],
      ['Updates and saves', 'Keep save data compatible between updates where you reasonably can, so players don’t lose progress. Each published version is permanent; you fix problems by publishing a newer one.'],
      ['Liability', 'You’re responsible for claims caused by your game breaking the promises above, and will cover our reasonable costs of dealing with them. Otherwise, each party’s liability is limited to the revenue share paid to you in the previous 12 months, except where the law doesn’t allow limits.'],
      ['Ending', 'You can stop selling a game or close your creator account at any time; players who already bought your games keep them. We may end this agreement with 30 days’ notice, or immediately for serious breaches. We’ll pay out everything you earned up to the end.'],
      ['Law', `Governed by ${LAW}. We’ll give you at least 30 days’ notice of material changes to this agreement.`],
    ],
  },
  refunds: {
    title: 'Refund Policy',
    summary: 'Didn’t click with a game? Here’s when you can get your money back.',
    sections: [
      ['The simple rule', 'You can refund any game you bought <b>within 14 days of purchase</b> if you’ve played it for <b>less than 2 hours</b>. Go to Profile → Purchase history and click “Refund”. The game is removed from your library and the money goes back to your original payment method, usually within 5–10 business days.'],
      ['Outside the window', 'If a game is broken, doesn’t match its store page, or was removed for legal or safety reasons, contact us at <a href="mailto:support@vibe-games.com">support@vibe-games.com</a> and we’ll help, even outside the 14 days / 2 hours.'],
      ['Free demos first', 'Most games have a free instant demo, and demo progress carries over when you buy. We recommend trying the demo before buying.'],
      ['Your legal rights (EU/UK)', 'Games are digital content delivered immediately. When you buy, you ask us to make the game available straight away and acknowledge that you lose the statutory 14-day right of withdrawal once it is available. Our own refund rule above still applies, and your rights for faulty digital content are never affected.'],
      ['Abuse', 'If refunds are being used to play games for free, we may decline them.'],
    ],
  },
};

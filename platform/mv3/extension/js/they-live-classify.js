/*******************************************************************************

    uBlock Origin Lite — They Live classification engine
    Copyright (C) 2022-present Raymond Hill

    Pure classification logic with no browser API dependencies.
    Exported so it can be unit-tested directly with Node.js:

        import { localClassify } from './they-live-classify.js';

*******************************************************************************/

// ---------------------------------------------------------------------------
// All 18 original They Live (1988) billboard messages.
// ---------------------------------------------------------------------------

export const THEY_LIVE_PHRASES = [
    'OBEY', 'CONSUME', 'WATCH TV', 'SLEEP', 'NO INDEPENDENT THOUGHT',
    'SUBMIT', 'CONFORM', 'STAY ASLEEP', 'BUY', 'WORK', 'DO NOT QUESTION AUTHORITY',
    'NO IMAGINATION', 'MARRY AND REPRODUCE', 'THIS IS YOUR GOD',
    'HONOR APATHY', 'NO IDEAS', 'WORK 8 HOURS', 'PLAY 8 HOURS',
];

// ---------------------------------------------------------------------------
// Local classification fast-path
// Checked before hitting the LLM. Resolves ~60-80% of ads with zero API cost.
// ---------------------------------------------------------------------------

// Partial hostname → phrase. Checked against [link:…] first, then [page:…].
export const DOMAIN_RULES = [
    // Retail / shopping
    ['amazon', 'CONSUME'], ['ebay', 'CONSUME'], ['etsy', 'CONSUME'],
    ['walmart', 'CONSUME'], ['bestbuy', 'BUY'], ['target', 'CONSUME'],
    ['shopify', 'BUY'], ['aliexpress', 'CONSUME'], ['wish', 'BUY'],
    ['wayfair', 'CONSUME'], ['homedepot', 'BUY'], ['costco', 'CONSUME'],
    ['ikea', 'CONSUME'], ['zara', 'CONSUME'], ['nike', 'BUY'],
    ['adidas', 'BUY'], ['macys', 'CONSUME'], ['nordstrom', 'CONSUME'],
    // Streaming / entertainment
    ['netflix', 'WATCH TV'], ['youtube', 'WATCH TV'], ['twitch', 'WATCH TV'],
    ['spotify', 'WATCH TV'], ['disneyplus', 'WATCH TV'], ['disney', 'WATCH TV'],
    ['hulu', 'WATCH TV'], ['primevideo', 'WATCH TV'], ['hbomax', 'WATCH TV'],
    ['peacock', 'WATCH TV'], ['appletv', 'WATCH TV'], ['paramountplus', 'WATCH TV'],
    ['crunchyroll', 'WATCH TV'], ['funimation', 'WATCH TV'],
    // Finance / insurance
    ['chase', 'THIS IS YOUR GOD'], ['fidelity', 'THIS IS YOUR GOD'], ['vanguard', 'THIS IS YOUR GOD'],
    ['schwab', 'THIS IS YOUR GOD'], ['wellsfargo', 'THIS IS YOUR GOD'], ['bankofamerica', 'THIS IS YOUR GOD'],
    ['citibank', 'THIS IS YOUR GOD'], ['capitalone', 'THIS IS YOUR GOD'], ['americanexpress', 'THIS IS YOUR GOD'],
    ['progressive', 'WORK'], ['geico', 'WORK'], ['allstate', 'WORK'],
    ['statefarm', 'WORK'], ['creditkarma', 'THIS IS YOUR GOD'], ['experian', 'THIS IS YOUR GOD'],
    ['equifax', 'THIS IS YOUR GOD'], ['lending', 'THIS IS YOUR GOD'], ['coinbase', 'THIS IS YOUR GOD'],
    ['binance', 'THIS IS YOUR GOD'], ['robinhood', 'THIS IS YOUR GOD'],
    // News / media
    ['cnn', 'NO INDEPENDENT THOUGHT'], ['foxnews', 'NO INDEPENDENT THOUGHT'],
    ['nytimes', 'NO INDEPENDENT THOUGHT'], ['washingtonpost', 'NO INDEPENDENT THOUGHT'],
    ['bbc', 'NO INDEPENDENT THOUGHT'], ['theguardian', 'NO INDEPENDENT THOUGHT'],
    ['reuters', 'NO INDEPENDENT THOUGHT'], ['apnews', 'NO INDEPENDENT THOUGHT'],
    ['huffpost', 'NO INDEPENDENT THOUGHT'], ['dailymail', 'NO INDEPENDENT THOUGHT'],
    ['breitbart', 'NO INDEPENDENT THOUGHT'], ['politico', 'NO INDEPENDENT THOUGHT'],
    ['thehill', 'NO INDEPENDENT THOUGHT'], ['axios', 'NO INDEPENDENT THOUGHT'],
    // Social / tech
    ['facebook', 'HONOR APATHY'], ['instagram', 'HONOR APATHY'], ['twitter', 'HONOR APATHY'],
    ['x.com', 'HONOR APATHY'], ['tiktok', 'HONOR APATHY'], ['snapchat', 'HONOR APATHY'],
    ['linkedin', 'WORK 8 HOURS'], ['pinterest', 'CONFORM'],
    // Gaming
    ['steampowered', 'PLAY 8 HOURS'], ['epicgames', 'PLAY 8 HOURS'], ['xbox', 'PLAY 8 HOURS'],
    ['playstation', 'PLAY 8 HOURS'], ['nintendo', 'PLAY 8 HOURS'], ['roblox', 'PLAY 8 HOURS'],
    ['ea.com', 'PLAY 8 HOURS'], ['ubisoft', 'PLAY 8 HOURS'], ['blizzard', 'PLAY 8 HOURS'],
    // Dating / reproduction
    ['tinder', 'MARRY AND REPRODUCE'], ['bumble', 'MARRY AND REPRODUCE'],
    ['match', 'MARRY AND REPRODUCE'], ['hinge', 'MARRY AND REPRODUCE'],
    ['eharmony', 'MARRY AND REPRODUCE'],
    // Jobs / recruitment
    ['indeed', 'WORK 8 HOURS'], ['glassdoor', 'WORK 8 HOURS'], ['monster', 'WORK 8 HOURS'],
    ['ziprecruiter', 'WORK 8 HOURS'], ['upwork', 'WORK 8 HOURS'],
];

// Regex rules applied to the selector string first, then full context.
// Rules match on ad *content* (what is being advertised), NOT ad *format*.
// Format tokens like "video", "player", "banner" are deliberately excluded:
// they describe the delivery mechanism, not the product category — a video ad
// for car insurance should be "THIS IS YOUR GOD", not "WATCH TV".
// Streaming services are caught by DOMAIN_RULES (netflix, hulu, etc.).
// Ordered from most specific to least.
export const KEYWORD_RULES = [
    [/\bgam(?:e|ing)\b|\besport\b/i, 'PLAY 8 HOURS'],
    [/\bshop\b|\bproduct\b|\bcart\b|\bcommerce\b|\bpurchase\b/i, 'BUY'],
    [/\bfinance\b|\bbank(?:ing)?\b|\binvest\b|\bloan\b|\binsur/i, 'THIS IS YOUR GOD'],
    [/\bcrypto\b|\bcoin\b|\btoken\b|\bnft\b|\bweb3\b/i, 'THIS IS YOUR GOD'],
    [/\bdat(?:e|ing)\b|\bmatrimony\b|\bwedding\b|\brelationship\b/i, 'MARRY AND REPRODUCE'],
    [/\bpregnancy\b|\bbaby\b|\bparenting\b|\bfertility\b/i, 'MARRY AND REPRODUCE'],
    [/\bjob\b|\bcareer\b|\brecruit\b|\bhiring\b|\bemploy\b/i, 'WORK 8 HOURS'],
    [/\bnews\b|\bbreaking\b|\bpoliti(?:cs|cal)\b|\bheadline\b/i, 'NO INDEPENDENT THOUGHT'],
    [/\bsocial\b|\bfollow\b|\bcommunity\b/i, 'HONOR APATHY'],
    [/\bsaas\b|\bsoftware\b|\bplatform\b/i, 'NO IDEAS'],
    [/\bsponsor(?:ed)?\b|\bpromot(?:ed|ion)\b|\badvert(?:is)?/i, 'OBEY'],
    [/\bleaderboard\b|\bskyscraper\b|\bbillboard\b|\bbanner\b/i, 'OBEY'],
];

// ---------------------------------------------------------------------------
// djb2 hash — used as cache key.
// ---------------------------------------------------------------------------

export const cacheKey = (s) => {
    let h = 5381;
    for ( let i = 0; i < s.length; i++ ) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
};

// ---------------------------------------------------------------------------
// Parse a context string; return a phrase or null for "needs LLM".
// ---------------------------------------------------------------------------

export const localClassify = (context) => {
    const pageMatch = context.match(/\[page:([^\]]+)\]/);
    const selMatch  = context.match(/\[sel:([^\]]+)\]/);
    const linkMatch = context.match(/\[link:([^\]]+)\]/);
    const linkHost  = linkMatch ? linkMatch[1] : '';
    const pageHost  = pageMatch ? pageMatch[1] : '';
    const selector  = selMatch  ? selMatch[1]  : '';

    // 1. Destination domain — strongest signal (what the ad is *advertising*).
    for ( const [pat, phrase] of DOMAIN_RULES ) {
        if ( linkHost.includes(pat) ) { return phrase; }
    }

    // 2. CSS selector keywords (contain ad-type info like .gaming-promo).
    for ( const [regex, phrase] of KEYWORD_RULES ) {
        if ( regex.test(selector) ) { return phrase; }
    }

    // 3. Full context scan — catches alt text, aria-label, visible text.
    for ( const [regex, phrase] of KEYWORD_RULES ) {
        if ( regex.test(context) ) { return phrase; }
    }

    // 4. Page domain — weakest (page may carry unrelated ads), but still useful.
    for ( const [pat, phrase] of DOMAIN_RULES ) {
        if ( pageHost.includes(pat) ) { return phrase; }
    }

    return null;
};

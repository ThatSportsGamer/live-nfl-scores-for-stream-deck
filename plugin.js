/**
 * NFL Scores — Stream Deck Plugin
 * Uses Node.js built-in modules only (net, https, crypto).
 * No npm packages required.
 */

'use strict';

const net    = require('net');
const https  = require('https');
const crypto = require('crypto');
const events = require('events');
const path   = require('path');
const fs     = require('fs');
const zlib   = require('zlib');

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'plugin.log');
try { fs.writeFileSync(LOG_FILE, `=== NFL Plugin ${new Date().toISOString()} ===\nNode: ${process.version}\nArgs: ${process.argv.slice(2).join(' ')}\n`); } catch (e) { /* ignore */ }

function log(...args) {
    const ts   = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { /* ignore */ }
}

process.on('uncaughtException',  err => log('CRASH:', err.stack || err.message));
process.on('unhandledRejection', err => log('UNHANDLED:', String(err)));

// ── TEST MODE (dev only) ────────────────────────────────────────────────────
// Set to a date string (e.g. '2026-09-01') to make the plugin think "today" is
// that date, so the rolling window picks up a future/past week's games for
// testing and screenshots. MUST be set back to null before shipping a release.
const DEBUG_ANCHOR_DATE = null;
if (DEBUG_ANCHOR_DATE) log('*** TEST MODE: pretending today is ' + DEBUG_ANCHOR_DATE + ' ***');

// Keyed by teamId — skips the ESPN fetch for that team only and renders the
// fixed game/state below instead, on whatever button that team is assigned
// to. Every other team keeps hitting the real API as normal, so you can put
// a different test scenario on each button at the same time (handy for
// lining up Marketplace screenshots without waiting for real games).
// A value of `null` forces that team's button into the "No Game" / bye-week
// state. MUST be set back to {} before shipping a release.
// Example — five buttons, five different states at once:
// const DEBUG_FAKE_GAMES = {
//     // Pre-game — assign this to Buffalo (2)
//     '2': {
//         state: 'preview', matchup: 'MIA @ BUF', eventId: 'debug-preview',
//         link: 'https://www.espn.com/nfl/',
//         awayId: '15', homeId: '2', awayAbbr: 'MIA', homeAbbr: 'BUF',
//         time: 'Sun 1:00 PM',
//     },
//     // Live, with possession + a normal (gold) clock line — assign to Kansas City (12)
//     '12': {
//         state: 'live', matchup: 'DEN @ KC', eventId: 'debug-live',
//         link: 'https://www.espn.com/nfl/',
//         awayId: '7', homeId: '12', awayAbbr: 'DEN', homeAbbr: 'KC',
//         awayScore: 10, homeScore: 17, period: 3, clock: '8:42',
//         statusName: 'STATUS_IN_PROGRESS', possession: '12', isRedZone: false,
//     },
//     // Live, in the red zone (orange-red clock line) — assign to Philadelphia (21)
//     '21': {
//         state: 'live', matchup: 'DAL @ PHI', eventId: 'debug-redzone',
//         link: 'https://www.espn.com/nfl/',
//         awayId: '6', homeId: '21', awayAbbr: 'DAL', homeAbbr: 'PHI',
//         awayScore: 14, homeScore: 17, period: 4, clock: '0:48',
//         statusName: 'STATUS_IN_PROGRESS', possession: '21', isRedZone: true,
//     },
//     // Final, with OT label — assign to San Francisco (25)
//     '25': {
//         state: 'final', matchup: 'SF @ SEA', eventId: 'debug-final',
//         link: 'https://www.espn.com/nfl/',
//         awayId: '25', homeId: '26', awayAbbr: 'SF', homeAbbr: 'SEA',
//         awayScore: 27, homeScore: 24, period: 5,
//     },
//     // Bye week / no game — assign to Green Bay (9)
//     '9': null,
// };
const DEBUG_FAKE_GAMES = {};
if (Object.keys(DEBUG_FAKE_GAMES).length) log('*** TEST MODE: returning fake games for ' + Object.keys(DEBUG_FAKE_GAMES).join(', ') + ' ***');

// ── Parse Stream Deck launch arguments ────────────────────────────────────────
let sdPort, pluginUUID, registerEvent;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-port')          sdPort        = argv[i + 1];
    if (argv[i] === '-pluginUUID')    pluginUUID    = argv[i + 1];
    if (argv[i] === '-registerEvent') registerEvent = argv[i + 1];
}

log('port=' + sdPort + ' uuid=' + pluginUUID + ' event=' + registerEvent);

if (!sdPort || !pluginUUID || !registerEvent) {
    log('ERROR: Missing required args. Stream Deck may not have launched this plugin correctly.');
    process.exit(1);
}

// ── Minimal WebSocket client (no external deps) ───────────────────────────────
class SimpleWS extends events.EventEmitter {
    constructor(port, host) {
        super();
        this.readyState  = 0; // CONNECTING
        this._buf        = Buffer.alloc(0);
        this._handshaked = false;

        this._sock = net.createConnection(parseInt(port, 10), host || '127.0.0.1');

        this._sock.on('connect', () => {
            log('TCP connected, sending WS upgrade...');
            const key = crypto.randomBytes(16).toString('base64');
            this._sock.write([
                'GET / HTTP/1.1',
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '', '',
            ].join('\r\n'));
        });

        this._sock.on('data',  chunk => this._onData(chunk));
        this._sock.on('error', err   => { log('TCP error:', err.message); this.emit('error', err); });
        this._sock.on('close', ()    => { this.readyState = 3; log('TCP closed'); this.emit('close'); });
    }

    _onData(chunk) {
        this._buf = Buffer.concat([this._buf, chunk]);

        if (!this._handshaked) {
            let end = -1;
            for (let i = 0; i <= this._buf.length - 4; i++) {
                if (this._buf[i]===13 && this._buf[i+1]===10 &&
                    this._buf[i+2]===13 && this._buf[i+3]===10) { end = i + 4; break; }
            }
            if (end === -1) return;

            const header = this._buf.slice(0, end).toString('ascii');
            log('HTTP response:', header.split('\r\n')[0]);

            if (!header.includes('101')) {
                log('WS upgrade failed!');
                this.emit('error', new Error('WebSocket upgrade rejected'));
                return;
            }

            this._handshaked = true;
            this.readyState  = 1; // OPEN
            this._buf        = this._buf.slice(end);
            log('WS handshake OK');
            this.emit('open');
        }

        this._parseFrames();
    }

    _parseFrames() {
        while (this._buf.length >= 2) {
            const b0       = this._buf[0];
            const b1       = this._buf[1];
            const opcode   = b0 & 0x0f;
            const isMasked = !!(b1 & 0x80);
            let   plen     = b1 & 0x7f;
            let   offset   = 2;

            if (plen === 126) {
                if (this._buf.length < 4) return;
                plen = this._buf.readUInt16BE(2); offset = 4;
            } else if (plen === 127) {
                if (this._buf.length < 10) return;
                plen = Number(this._buf.readBigUInt64BE(2)); offset = 10;
            }

            const maskLen = isMasked ? 4 : 0;
            const total   = offset + maskLen + plen;
            if (this._buf.length < total) return;

            let payload = Buffer.from(this._buf.slice(offset + maskLen, total));
            if (isMasked) {
                const mask = this._buf.slice(offset, offset + 4);
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            }
            this._buf = this._buf.slice(total);

            if      (opcode === 0x1) this.emit('message', payload.toString('utf8'));
            else if (opcode === 0x8) { this.readyState = 3; log('WS close frame'); this.emit('close'); return; }
            else if (opcode === 0x9) this._sendFrame(0x8a, payload); // pong — must echo ping payload per RFC 6455
        }
    }

    send(str) {
        if (this.readyState !== 1) { log('WARN: send() called but WS not open (state=' + this.readyState + ')'); return; }
        this._sendFrame(0x81, Buffer.from(String(str), 'utf8'));
    }

    // Write one WebSocket frame. Client frames must be masked per RFC 6455.
    _sendFrame(opcode, payload) {
        const len  = payload.length;
        const mask = crypto.randomBytes(4);
        let   hdr;

        if (len < 126) {
            hdr = Buffer.alloc(6);
            hdr[0] = opcode; hdr[1] = 0x80 | len;
            mask.copy(hdr, 2);
        } else if (len < 65536) {
            hdr = Buffer.alloc(8);
            hdr[0] = opcode; hdr[1] = 0x80 | 126;
            hdr.writeUInt16BE(len, 2);
            mask.copy(hdr, 4);
        } else {
            log('WS: payload too large (' + len + ' bytes)'); return;
        }

        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        this._sock.write(Buffer.concat([hdr, masked]));
    }
}

// ── Plugin state ──────────────────────────────────────────────────────────────
const instances      = new Map(); // context -> { teamId, teamAbbr }
const prevScores     = new Map(); // context -> { awayScore, homeScore }
const prevState      = new Map(); // context -> last known game state string
const flashing        = new Set(); // contexts mid-flash animation
const refreshing      = new Set(); // contexts mid-async refresh
const lastRender       = new Map(); // context -> JSON key of last rendered lines
const currentGame      = new Map(); // context -> parsed game object | null
const refreshTimers    = new Map(); // context -> intervalId (staggered per-button timers)

// ── Connect to Stream Deck ────────────────────────────────────────────────────
log('Connecting to Stream Deck on port', sdPort);
const ws = new SimpleWS(sdPort);

ws.on('open', () => {
    log('WS open — registering plugin');
    ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
});

ws.on('message', raw => {
    let ev;
    try { ev = JSON.parse(raw); } catch (e) { log('Bad JSON:', e.message); return; }
    log('← SD event:', ev.event, ev.context ? ev.context.slice(0, 8) : '');
    try { handleEvent(ev); } catch (e) { log('handleEvent crash:', e.stack || e.message); }
});

ws.on('error', err => log('WS error:', err.message));
ws.on('close', ()  => {
    log('WS closed — exiting so Stream Deck can restart');
    setTimeout(() => process.exit(0), 2000);
});

// ── Stream Deck event handler ─────────────────────────────────────────────────
function handleEvent({ event, context, payload }) {
    switch (event) {

        case 'willAppear':
            instances.set(context, (payload && payload.settings) || {});
            log('willAppear — settings:', instances.get(context));
            if (refreshTimers.has(context)) clearInterval(refreshTimers.get(context));
            refreshTimers.set(context, setInterval(() => refreshButton(context), 30_000));
            refreshButton(context);
            break;

        case 'willDisappear':
            instances.delete(context);
            prevScores.delete(context);
            prevState.delete(context);
            lastRender.delete(context);
            currentGame.delete(context);
            refreshing.delete(context);
            flashing.delete(context);
            if (refreshTimers.has(context)) {
                clearInterval(refreshTimers.get(context));
                refreshTimers.delete(context);
            }
            break;

        case 'didReceiveSettings':
            instances.set(context, (payload && payload.settings) || {});
            log('didReceiveSettings:', instances.get(context));
            lastRender.delete(context); // force redraw with new settings
            refreshButton(context);
            break;

        case 'keyUp': {
            const game = currentGame.get(context);
            if (game && game.link) {
                log('keyUp — opening URL:', game.link);
                ws.send(JSON.stringify({ event: 'openUrl', payload: { url: game.link } }));
            } else {
                const cfg    = instances.get(context) || {};
                const teamId = cfg.teamId;
                if (teamId) {
                    const scheduleUrl = 'https://www.espn.com/nfl/team/schedule/_/id/' + teamId;
                    log('keyUp — no game, opening schedule:', scheduleUrl);
                    ws.send(JSON.stringify({ event: 'openUrl', payload: { url: scheduleUrl } }));
                } else {
                    log('keyUp — no game, no teamId, refreshing');
                    lastRender.delete(context);
                    refreshButton(context);
                }
            }
            break;
        }

        case 'sendToPlugin':
            if (payload && payload.settings) {
                instances.set(context, payload.settings);
                lastRender.delete(context);
                refreshButton(context);
            }
            break;
    }
}

// ── Refresh one button ────────────────────────────────────────────────────────
async function refreshButton(context) {
    if (refreshing.has(context)) { log('Refresh already in progress, skipping'); return; }
    if (flashing.has(context))   { log('Flash in progress, skipping refresh'); return; }

    const cfg = instances.get(context);
    if (!cfg || !cfg.teamId) {
        setButton(context, ['Select A', 'Team In', 'Settings']);
        return;
    }

    refreshing.add(context);
    log('Refreshing', cfg.teamAbbr || cfg.teamId);
    try {
        const game = await fetchTeamGame(cfg.teamId);
        currentGame.set(context, game || null);

        // Detect live → final transition and play fireworks
        const prevGameState = prevState.get(context);
        prevState.set(context, game ? game.state : null);
        if (prevGameState === 'live' && game && game.state === 'final') {
            const winnerIsHome = game.homeScore >= game.awayScore;
            const winnerId     = winnerIsHome ? game.homeId : game.awayId;
            log('Game over — fireworks for', teamName(winnerId));
            refreshing.delete(context);
            playFireworks(context, teamName(winnerId), teamColor(winnerId)).catch(e => log('fireworks error:', e.message));
            return;
        }

        const lines   = buildLines(game, cfg);
        const spacing = lines.some(l => typeof l === 'object') ? 1.2 : 1.4;
        log('→', JSON.stringify(lines));

        // Detect score change on live games and flash in the scoring team's color
        const prev = prevScores.get(context);
        if (game && game.state === 'live') {
            prevScores.set(context, { awayScore: game.awayScore, homeScore: game.homeScore });
            if (prev) {
                const awayScored = game.awayScore > prev.awayScore;
                const homeScored = game.homeScore > prev.homeScore;
                if (awayScored || homeScored) {
                    const color = (awayScored && homeScored) ? '#FFFFFF'
                        : awayScored ? teamColor(game.awayId)
                                     : teamColor(game.homeId);
                    log('Score change — flashing', color);
                    refreshing.delete(context);
                    flashButton(context, color, lines, spacing).catch(e => log('flashButton error:', e.message));
                    return;
                }
            }
        } else {
            prevScores.delete(context);
        }

        setButton(context, lines, spacing);
    } catch (err) {
        log('Fetch error:', err.message);
        setButton(context, [cfg.teamAbbr || 'NFL', 'Err']);
    } finally {
        refreshing.delete(context);
    }
}

// ── Text sizing helper — shrink font until the line fits the button width ─────
// Uses the same real glyph-width table as the centering math (see textWidthPx
// below) instead of a flat per-char estimate, so wide abbreviations like
// "LAR" or "WSH" get sized just as precisely as narrow ones like "GB".
function fitFs(text, maxFs) {
    let fs = maxFs;
    while (fs > 9 && textWidthPx(text, fs) > 64) fs--;
    return fs;
}

// ── Fixed size tier for the live/final score lines ─────────────────────────
// Every NFL abbreviation in TEAMS is 2-3 characters (GB, KC, LV, NE, NO, SF,
// TB are the two-letter ones), so a single fixed size covers the whole
// roster. fitFs() still runs as a per-game fallback for any unusually wide
// abbreviation/score combination.
function baseTierFs(abbr) {
    return abbr.length >= 4 ? 16 : 17;
}

// Real Helvetica-Bold glyph widths (per 1000 em units, from the standard AFM
// metrics) — used only where we anchor two separately-colored text segments
// on a shared boundary point (see makeImage). A flat "every char is 0.6em"
// estimate treats e.g. "LAR" and "TEN" as equal width, but the wide letters
// are notably wider than the narrow ones — that mismatch is what made the
// two team lines look inconsistently centered against each other on real
// hardware. Digits are all the same width in Helvetica (tabular figures), so
// scores were never the issue. This table only needs to cover what can
// actually appear here: A-Z (abbreviations) and 0-9 (scores).
const GLYPH_WIDTH_1000 = {
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 556, K: 722, L: 611, M: 889, N: 722, O: 778, P: 667, Q: 778, R: 722,
    S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
    ' ': 278, // real Helvetica-Bold space width
};
function textWidthPx(str, fs) {
    let units = 0;
    for (const ch of str) units += GLYPH_WIDTH_1000[ch] !== undefined ? GLYPH_WIDTH_1000[ch] : 600;
    return units * fs / 1000;
}

// ── Quarter / overtime label ──────────────────────────────────────────────────
function periodLabel(period) {
    if (period >= 1 && period <= 4) return 'Q' + period;
    const ot = period - 4;
    return ot <= 1 ? 'OT' : ot + 'OT';
}

// Parses ESPN's "M:SS" display clock into total seconds — returns null for
// anything that doesn't match (e.g. an empty string during a status change).
function parseClockSeconds(clockStr) {
    if (!clockStr) return null;
    const m = /^(\d+):(\d{2})$/.exec(clockStr.trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ── Build button display lines ────────────────────────────────────────────────
function buildLines(game, cfg) {
    const abbr = cfg.teamAbbr || 'NFL';
    if (!game) return [abbr, 'No Game'];

    if (game.state === 'preview') return [game.matchup, game.time];
    if (game.state === 'ppd')     return [game.matchup, { text: 'PPD',   fs: 16, color: '#E74C3C' }];
    if (game.state === 'delay')   return [game.matchup, { text: 'DELAY', fs: 14, color: '#3498DB' }];

    if (game.state === 'live') {
        const awayBall  = !!game.possession && game.possession === String(game.awayId);
        const homeBall  = !!game.possession && game.possession === String(game.homeId);
        const awayPlain = game.awayAbbr + ' ' + game.awayScore;
        const homePlain = game.homeAbbr + ' ' + game.homeScore;
        const ceiling   = Math.min(baseTierFs(game.awayAbbr), baseTierFs(game.homeAbbr));
        // No extra safety margin needed here — the parts-based split below uses
        // an explicit GAP of fs*0.28 between the two anchored text elements,
        // which is close enough to the real Helvetica-Bold space width (0.278em)
        // that the plain "ABBR SCORE" width check fitFs() does is already an
        // accurate stand-in for the split rendering.
        const fs = Math.min(fitFs(awayPlain, ceiling), fitFs(homePlain, ceiling));

        // Possession shown by coloring just the team abbreviation — the score
        // stays white. Text content never changes length based on possession,
        // so both lines stay naturally aligned with no shifting. Three states
        // on the same element: white (no ball) -> brown (has ball) -> orange
        // (has ball AND in the red zone). Red zone can only ever apply to
        // whichever team currently has the ball, so this is a strict upgrade
        // of the possession signal, not a conflicting second one.
        const POSSESSION_BROWN   = '#C08552';
        const POSSESSION_REDZONE = '#FF4500';
        const possessionColor = hasBall => hasBall
            ? (game.isRedZone ? POSSESSION_REDZONE : POSSESSION_BROWN)
            : 'white';
        // No leading space on the score part — SVG text elements can trim
        // leading whitespace, which silently ate the gap on real hardware.
        // The visual gap is now an explicit pixel offset in makeImage instead.
        const awayLine = { fs, parts: [
            { text: game.awayAbbr,            color: possessionColor(awayBall) },
            { text: String(game.awayScore),   color: 'white' },
        ] };
        const homeLine = { fs, parts: [
            { text: game.homeAbbr,            color: possessionColor(homeBall) },
            { text: String(game.homeScore),   color: 'white' },
        ] };

        // The clock line tracks the two-minute warning only (moved off onto the
        // possessing team's abbreviation above for red zone).
        let clockText, clockColor;
        if (game.statusName === 'STATUS_HALFTIME') {
            clockText  = 'Halftime';
            clockColor = '#FFD700';
        } else if (game.statusName === 'STATUS_END_PERIOD') {
            clockText  = 'End ' + periodLabel(game.period);
            clockColor = '#FFD700';
        } else {
            clockText = (game.clock || '') + ' ' + periodLabel(game.period);
            // Two-minute warning — pure red. Only applies at the end of the 2nd
            // and 4th quarters, not every period.
            const secondsLeft = parseClockSeconds(game.clock);
            const isTwoMinWarning = (game.period === 2 || game.period === 4) &&
                secondsLeft !== null && secondsLeft <= 120;
            clockColor = isTwoMinWarning ? '#FF0000' : '#FFD700';
        }

        return [
            awayLine,
            homeLine,
            { text: clockText, fs: 11, color: clockColor },
        ];
    }

    if (game.state === 'final') {
        const awayText = game.awayAbbr + ' ' + game.awayScore;
        const homeText = game.homeAbbr + ' ' + game.homeScore;
        const ceiling   = Math.min(baseTierFs(game.awayAbbr), baseTierFs(game.homeAbbr));
        const fs        = Math.min(fitFs(awayText, ceiling), fitFs(homeText, ceiling));
        const ot        = game.period > 4 ? game.period - 4 : 0;
        const label     = ot === 0 ? 'Final' : (ot === 1 ? 'Final/OT' : 'Final/' + ot + 'OT');
        return [
            { text: awayText, fs },
            { text: homeText, fs },
            { text: label, fs: 12, color: '#FFD700' },
        ];
    }

    return [abbr, '---'];
}

// ── Team data (abbr, full name, short name, primary color, division) ──────────
// Source: ESPN NFL API — all 32 teams, 8 divisions
const TEAMS = {
    // AFC East
    '2':  { abbr: 'BUF', name: 'Buffalo Bills',       short: 'Bills',      color: '#00338D' },
    '15': { abbr: 'MIA', name: 'Miami Dolphins',      short: 'Dolphins',   color: '#008E97' },
    '17': { abbr: 'NE',  name: 'New England Patriots',short: 'Patriots',   color: '#002A5C' },
    '20': { abbr: 'NYJ', name: 'New York Jets',       short: 'Jets',       color: '#115740' },
    // AFC North
    '33': { abbr: 'BAL', name: 'Baltimore Ravens',    short: 'Ravens',     color: '#29126F' },
    '4':  { abbr: 'CIN', name: 'Cincinnati Bengals',  short: 'Bengals',    color: '#FB4F14' },
    '5':  { abbr: 'CLE', name: 'Cleveland Browns',    short: 'Browns',     color: '#472A08' },
    '23': { abbr: 'PIT', name: 'Pittsburgh Steelers', short: 'Steelers',   color: '#FFB612' },
    // AFC South
    '34': { abbr: 'HOU', name: 'Houston Texans',      short: 'Texans',     color: '#00143F' },
    '11': { abbr: 'IND', name: 'Indianapolis Colts',  short: 'Colts',      color: '#003B75' },
    '30': { abbr: 'JAX', name: 'Jacksonville Jaguars',short: 'Jaguars',    color: '#007487' },
    '10': { abbr: 'TEN', name: 'Tennessee Titans',    short: 'Titans',     color: '#4495D2' },
    // AFC West
    '7':  { abbr: 'DEN', name: 'Denver Broncos',      short: 'Broncos',    color: '#0A2343' },
    '12': { abbr: 'KC',  name: 'Kansas City Chiefs',  short: 'Chiefs',     color: '#E31837' },
    '13': { abbr: 'LV',  name: 'Las Vegas Raiders',   short: 'Raiders',    color: '#A5ACAF' },
    '24': { abbr: 'LAC', name: 'Los Angeles Chargers',short: 'Chargers',   color: '#0080C6' },
    // NFC East
    '6':  { abbr: 'DAL', name: 'Dallas Cowboys',      short: 'Cowboys',    color: '#041E42' },
    '19': { abbr: 'NYG', name: 'New York Giants',     short: 'Giants',     color: '#003C7F' },
    '21': { abbr: 'PHI', name: 'Philadelphia Eagles', short: 'Eagles',     color: '#06424D' },
    '28': { abbr: 'WSH', name: 'Washington Commanders',short: 'Commanders',color: '#5A1414' },
    // NFC North
    '3':  { abbr: 'CHI', name: 'Chicago Bears',       short: 'Bears',      color: '#0B1C3A' },
    '8':  { abbr: 'DET', name: 'Detroit Lions',       short: 'Lions',      color: '#0076B6' },
    '9':  { abbr: 'GB',  name: 'Green Bay Packers',   short: 'Packers',    color: '#204E32' },
    '16': { abbr: 'MIN', name: 'Minnesota Vikings',   short: 'Vikings',    color: '#4F2683' },
    // NFC South
    '1':  { abbr: 'ATL', name: 'Atlanta Falcons',     short: 'Falcons',    color: '#A71930' },
    '29': { abbr: 'CAR', name: 'Carolina Panthers',   short: 'Panthers',   color: '#0085CA' },
    '18': { abbr: 'NO',  name: 'New Orleans Saints',  short: 'Saints',     color: '#D3BC8D' },
    '27': { abbr: 'TB',  name: 'Tampa Bay Buccaneers',short: 'Buccaneers', color: '#BD1C36' },
    // NFC West
    '22': { abbr: 'ARI', name: 'Arizona Cardinals',   short: 'Cardinals',  color: '#A40227' },
    '14': { abbr: 'LAR', name: 'Los Angeles Rams',    short: 'Rams',       color: '#003594' },
    '25': { abbr: 'SF',  name: 'San Francisco 49ers', short: '49ers',      color: '#AA0000' },
    '26': { abbr: 'SEA', name: 'Seattle Seahawks',    short: 'Seahawks',   color: '#69BE28' },
};

const teamAbbr  = id => TEAMS[id]?.abbr  || '???';
const teamColor = id => TEAMS[id]?.color || '#FFFFFF';
const teamName  = id => TEAMS[id]?.short || teamAbbr(id);

// ── ESPN API ──────────────────────────────────────────────────────────────────
function fetchTeamGame(teamId) {
    // hasOwnProperty (not just truthiness) so a `null` entry — used to force the
    // "No Game" state — is honored instead of falling through to the real API.
    if (Object.prototype.hasOwnProperty.call(DEBUG_FAKE_GAMES, teamId)) {
        return Promise.resolve(DEBUG_FAKE_GAMES[teamId]);
    }

    return new Promise((resolve, reject) => {
        const now = DEBUG_ANCHOR_DATE ? new Date(DEBUG_ANCHOR_DATE) : new Date();
        // Don't roll to the next day's slate until 2am — covers late-running games
        if (!DEBUG_ANCHOR_DATE && now.getHours() < 2) now.setDate(now.getDate() - 1);

        const fmt = d => d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');

        // NFL teams play roughly one game per week, not daily — pull a 21-day
        // window (ten days back, ten days ahead) and pick the most relevant
        // game for this team out of it. This comfortably covers a bye week
        // with margin to spare, while staying well under ESPN's default
        // response cap for a single week's scoreboard.
        const start = new Date(now); start.setDate(start.getDate() - 10);
        const end   = new Date(now); end.setDate(end.getDate() + 10);

        const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' +
            '?dates=' + fmt(start) + '-' + fmt(end);

        // ESPN's edge (Akamai) started rejecting requests that don't look like a
        // real browser — a bare custom User-Agent with no Accept/Accept-Encoding
        // was getting a 403 "Access Denied" HTML page back instead of JSON. A
        // realistic browser header set (including Accept-Encoding, which the
        // response is then actually compressed with) is what gets a real 200.
        const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br',
        };

        const req = https.get(url, { headers: reqHeaders }, res => {
            if (res.statusCode !== 200) {
                res.resume(); // drain so the socket can be reused/closed cleanly
                reject(new Error('HTTP ' + res.statusCode));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    let buf = Buffer.concat(chunks);
                    const enc = res.headers['content-encoding'];
                    if (enc === 'gzip')      buf = zlib.gunzipSync(buf);
                    else if (enc === 'br')   buf = zlib.brotliDecompressSync(buf);
                    else if (enc === 'deflate') buf = zlib.inflateSync(buf);
                    resolve(parseGames(JSON.parse(buf.toString('utf8')), teamId, now));
                } catch (e) { reject(e); }
            });
        });

        req.on('error', reject);
        req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}

// Pick the single most relevant event for this team out of a multi-week scoreboard:
// a game in progress beats an upcoming game, which beats a past final (so the button
// holds last week's result until the next game appears).
function parseGames(data, teamId, now) {
    try {
        const allEvents = data?.events || [];
        if (!allEvents.length) { log('API: no events in range'); return null; }

        const matches = allEvents.filter(e => {
            const comp = e.competitions && e.competitions[0];
            if (!comp || !comp.competitors) return false;
            return comp.competitors.some(c => String(c.team?.id) === String(teamId));
        });
        if (!matches.length) { log('API: no games found for team', teamId); return null; }

        let best = null, bestRank = -1, bestTime = null;
        for (const e of matches) {
            const comp  = e.competitions[0];
            const state = (comp.status || e.status)?.type?.state;
            const time  = new Date(e.date).getTime();
            const rank  = state === 'in' ? 3 : state === 'pre' ? 2 : 1; // post/final = 1

            if (rank > bestRank) {
                best = e; bestRank = rank; bestTime = time;
            } else if (rank === bestRank) {
                if (rank === 2 && time < bestTime) { best = e; bestTime = time; } // soonest upcoming
                if (rank === 1 && time > bestTime) { best = e; bestTime = time; } // most recent final
            }
        }
        return parseEvent(best, now);
    } catch (e) {
        log('parseGames error:', e.message);
        return null;
    }
}

function parseEvent(e, now) {
    const comp   = e.competitions[0];
    const status = comp.status || e.status || {};
    const type   = status.type || {};
    const state  = type.state;       // 'pre' | 'in' | 'post'
    const name   = type.name || '';  // e.g. STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL

    const away = comp.competitors.find(c => c.homeAway === 'away');
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const awayId = away?.team?.id, homeId = home?.team?.id;
    const awayAbbr = teamAbbr(awayId), homeAbbr = teamAbbr(homeId);
    const matchup  = awayAbbr + ' @ ' + homeAbbr;

    const gcLink = (e.links || []).find(l => (l.text || '').toLowerCase() === 'gamecast') || (e.links || [])[0];
    const link   = gcLink?.href || ('https://www.espn.com/nfl/game/_/gameId/' + e.id);

    const base = { matchup, awayId, homeId, awayAbbr, homeAbbr, eventId: e.id, link };

    if (name.includes('POSTPONED') || name.includes('CANCEL')) return { ...base, state: 'ppd' };
    if (/DELAY/.test(name))                                    return { ...base, state: 'delay' };

    if (state === 'pre') {
        return { ...base, state: 'preview', time: fmtTime(e.date, now) };
    }

    const awayScore = parseInt(away?.score, 10) || 0;
    const homeScore = parseInt(home?.score, 10) || 0;
    const period     = status.period || type.period || 1;

    if (state === 'post') {
        return { ...base, state: 'final', awayScore, homeScore, period };
    }

    // Live — pull down/distance/possession info defensively; ESPN omits `situation`
    // for some early-game states, so everything here gracefully degrades to "unknown".
    const sit         = comp.situation || {};
    const possession  = sit.possession != null ? String(sit.possession) : null;

    return {
        ...base,
        state: 'live',
        awayScore, homeScore, period,
        clock:      status.displayClock || '',
        statusName: name,
        possession,
        isRedZone:  !!sit.isRedZone,
    };
}

function fmtTime(iso, now) {
    try {
        const d   = new Date(iso);
        const day = d.toLocaleDateString([], { weekday: 'short' });

        // More than ~6 days out, "Sun" alone is ambiguous (which Sunday?) — show
        // the actual date instead of a time that's still likely to get adjusted anyway.
        if (now) {
            const diffDays = Math.round((d - now) / 86400000);
            if (diffDays >= 7) {
                const date = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
                return day + ' ' + date;
            }
        }

        const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return day + ' ' + time;
    } catch (e) { return '?:??'; }
}

// ── SVG button renderer ───────────────────────────────────────────────────────
function escXml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Accepts an array of strings (auto-sized) or { text, fs, color } objects (explicit size).
function makeImage(lines, lineSpacing = 1.4, bgColor = 'black') {
    const W = 72, H = 72, PAD = 4, MAX_W = W - PAD * 2;

    const items = lines.map(l => {
        if (typeof l === 'string') {
            let fs = 16;
            while (fs > 8 && l.length * fs * 0.60 > MAX_W) fs--;
            return { text: l, fs };
        }
        return l;
    });

    const lineHeights = items.map(({ fs }) => fs * lineSpacing);
    const totalH      = lineHeights.reduce((a, b) => a + b, 0);
    let   y           = (H - totalH) / 2 + items[0].fs * 0.80;

    // Lines may carry a `parts` array of exactly 2 segments (e.g.
    // [{text:'KC',color:brown}, {text:' 17',color:white}]) instead of a single
    // `text` string — used for the live-game score lines so the possession
    // indicator can recolor just the team abbreviation while the score stays
    // white. (A single text-anchor="middle" element with multiple colored
    // <tspan>s is unreliable across SVG renderers and was dropped earlier.)
    //
    // The two segments are anchored on either side of one shared boundary
    // point: the left segment is text-anchor="end" at the boundary (its real
    // right edge lands exactly there) and the right segment is
    // text-anchor="start" at the same boundary (its real left edge lands
    // exactly there). Each renderer positions every segment using its own
    // *actual* glyph widths, so the two can never collide — only the
    // boundary's overall placement depends on our width estimate, and any
    // error there just nudges the whole pair slightly off-center instead of
    // causing an overlap. Both lines always use this same approach regardless
    // of who has the ball, so the text's own position never shifts when
    // possession changes.
    const rows = items.map(({ text, fs, color, parts }, i) => {
        if (i > 0) y += lineHeights[i - 1] - items[i - 1].fs * 0.80 + fs * 0.80;

        if (parts && parts.length === 2) {
            const GAP    = fs * 0.28;   // explicit visual gap — not a space character,
                                        // which renderers can trim and silently lose
            // Real per-glyph widths, not a flat per-char estimate — letters like
            // "L"/"R" are meaningfully wider than "I", so a flat estimate made
            // different team abbreviations land at different true visual
            // centers even though they shared the same boundary formula.
            const w0     = textWidthPx(parts[0].text, fs);
            const w1     = textWidthPx(parts[1].text, fs);
            let boundary = 36 - (w0 + w1 + GAP) / 2 + w0;
            // Defensive clamp: if a renderer's actual glyph widths run wider than
            // our estimate, keep the boundary far enough from each edge that the
            // segment anchored there still has reasonable room, rather than
            // letting the estimate alone push it flush against — or past — PAD.
            const PAD_X = 4;
            boundary = Math.max(boundary, PAD_X + w0);
            boundary = Math.min(boundary, (W - PAD_X) - w1 - GAP);
            return (
                `<text x="${boundary.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" fill="${parts[0].color || color || 'white'}" ` +
                `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(parts[0].text)}</text>` +
                `<text x="${(boundary + GAP).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="start" fill="${parts[1].color || color || 'white'}" ` +
                `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(parts[1].text)}</text>`
            );
        }

        return `<text x="36" y="${y.toFixed(1)}" text-anchor="middle" fill="${color || 'white'}" ` +
               `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(text)}</text>`;
    }).join('');

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="${bgColor}"/>` +
        rows + `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function makeFireworks(frame, winnerColor, winnerName) {
    const W = 72, H = 72;
    const cx = 36, cy = 36;
    const COLORS = [winnerColor, '#FFD700', '#FFFFFF'];

    let circles = '';
    // Overlapping burst waves every 4 frames across the full animation
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].forEach((startFrame, burstIdx) => {
        const f = frame - startFrame;
        if (f < 0 || f >= 6) return;
        const progress = f / 5;
        const r        = 5 + progress * 28;
        const pSize    = Math.max(0.5, 3.5 - progress * 2.5);
        const opacity  = (1 - progress * 0.65).toFixed(2);
        for (let i = 0; i < 8; i++) {
            const angle = (i * 45 + burstIdx * 22.5) * Math.PI / 180;
            const px    = (cx + r * Math.cos(angle)).toFixed(1);
            const py    = (cy + r * Math.sin(angle)).toFixed(1);
            const color = COLORS[(i + burstIdx) % COLORS.length];
            circles += `<circle cx="${px}" cy="${py}" r="${pSize.toFixed(1)}" fill="${color}" opacity="${opacity}"/>`;
        }
    });

    // Throbbing text — alternates every 2 frames
    const throb   = Math.floor(frame / 2) % 2 === 0;
    const winSize = throb ? 20 : 16;

    // Auto-size team name to fit the button width
    let nameSize = 13;
    while (nameSize > 7 && winnerName.length * nameSize * 0.62 > 62) nameSize--;
    const nameY = throb ? 25 : 27;

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="black"/>` +
        circles +
        `<text x="36" y="${nameY}" text-anchor="middle" fill="white" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${nameSize}" font-weight="700">${escXml(winnerName)}</text>` +
        `<text x="36" y="50" text-anchor="middle" fill="#FFD700" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${winSize}" font-weight="800">WIN!</text>` +
        `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function playFireworks(context, winnerName, winnerColor) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ fireworks for', winnerName, winnerColor);
    try {
        for (let i = 0; i < 42; i++) {
            const img = makeFireworks(i, winnerColor, winnerName);
            ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: img, target: 0 } }));
            await sleep(120);
        }
    } finally {
        flashing.delete(context);
        lastRender.delete(context);
        refreshButton(context);
    }
}

function setButton(context, lines, lineSpacing, bgColor) {
    const key = JSON.stringify(lines);
    if (!bgColor && lastRender.get(context) === key) return; // skip if unchanged
    if (!bgColor) lastRender.set(context, key);
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: makeImage(lines, lineSpacing, bgColor), target: 0 } }));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function flashButton(context, color, lines, spacing) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ flash', color);
    try {
        for (let i = 0; i < 4; i++) {
            setButton(context, lines, spacing, color);
            await sleep(200);
            setButton(context, lines, spacing, 'black');
            await sleep(200);
        }
    } finally {
        flashing.delete(context);
        setButton(context, lines, spacing, 'black');
    }
}

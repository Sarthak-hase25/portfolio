const express = require('express');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Live-reload SSE endpoint for instantaneous browser auto-refresh
const liveReloadClients = new Set();
app.get('/live-reload', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();
    liveReloadClients.add(res);
    req.on('close', () => liveReloadClients.delete(res));
});

let reloadDebounce;
function triggerLiveReload() {
    clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(() => {
        for (const client of liveReloadClients) {
            try {
                client.write('data: reload\n\n');
            } catch (err) {
                liveReloadClients.delete(client);
            }
        }
    }, 120);
}

// Watch views and public folders for changes
try {
    fs.watch(path.join(__dirname, 'views'), { recursive: true }, () => triggerLiveReload());
    fs.watch(path.join(__dirname, 'public'), { recursive: true }, () => triggerLiveReload());
} catch (e) {
    console.warn('Live-reload watcher note:', e.message);
}

// Routes
app.get('/', (req, res) => {
    res.render('index', { title: 'My Portfolio' });
});

// GitHub contribution chart: 2026-only calendar generator with dark-mode theme
let cached2026Svg = null;
let lastChartFetch = 0;
const CHART_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function generate2026GithubChart() {
    const now = Date.now();
    if (cached2026Svg && (now - lastChartFetch) < CHART_CACHE_TTL) {
        return cached2026Svg;
    }

    try {
        const response = await fetch('https://ghchart.rshah.org/f97316/sarthak-hase25');
        const upstreamSvg = await response.text();

        // Extract contribution date fills and scores from upstream chart
        const dateData = new Map();
        const rectMatches = upstreamSvg.matchAll(/<rect\s+([^>]+)\/?>/g);
        for (const match of rectMatches) {
            const attrs = match[1];
            const dateM = attrs.match(/data-date="(2026-[^"]+)"/);
            if (!dateM) continue;
            const scoreM = attrs.match(/data-score="([^"]+)"/);
            const fillM = attrs.match(/fill:([^;"]+)/) || attrs.match(/fill="([^"]+)"/);
            let fill = fillM ? fillM[1].trim() : '#162033';
            if (fill.toUpperCase() === '#EEEEEE') fill = '#162033';
            dateData.set(dateM[1], { fill, score: scoreM ? scoreM[1] : '0' });
        }

        // Generate full 2026 calendar (Jan 1, 2026 to Dec 31, 2026)
        const startDate = new Date('2026-01-01T00:00:00Z');
        const endDate = new Date('2026-12-31T00:00:00Z');

        // Start from the Sunday of the week containing Jan 1 (Dec 28, 2025)
        const curr = new Date(startDate);
        curr.setUTCDate(curr.getUTCDate() - curr.getUTCDay());

        let weekIdx = 0;
        const rects = [];
        const monthLabels = [];
        let lastMonth = -1;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        while (curr <= endDate || curr.getUTCDay() !== 0) {
            const day = curr.getUTCDay();
            const dateStr = curr.toISOString().split('T')[0];
            const is2026 = curr.getUTCFullYear() === 2026;
            const month = curr.getUTCMonth();

            const x = 27 + weekIdx * 12;
            const y = 20 + day * 12;

            if (day === 0 && is2026 && month !== lastMonth) {
                monthLabels.push({ name: monthNames[month], x: month === 0 ? 27 : x });
                lastMonth = month;
            }

            if (is2026) {
                const data = dateData.get(dateStr) || { fill: '#162033', score: '0' };
                rects.push(`<rect style="fill:${data.fill};shape-rendering:crispedges;" data-score="${data.score}" data-date="${dateStr}" x="${x}" y="${y}" width="10" height="10"/>`);
            }

            curr.setUTCDate(curr.getUTCDate() + 1);
            if (curr.getUTCDay() === 0) {
                weekIdx++;
            }
        }

        const totalWidth = 27 + weekIdx * 12 + 10;

        const monthTexts = monthLabels.map(m =>
            `<text style="fill:#94A3B8;text-anchor:start;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:10px;" x="${m.x}" y="10">${m.name}</text>`
        ).join('');

        const dayTexts = `
            <text style="fill:#94A3B8;text-anchor:start;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:9px;" x="0" y="40">Mon</text>
            <text style="fill:#94A3B8;text-anchor:start;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:9px;" x="0" y="64">Wed</text>
            <text style="fill:#94A3B8;text-anchor:start;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:9px;" x="0" y="89">Fri</text>
        `;

        cached2026Svg = `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="104" viewBox="0 0 ${totalWidth} 104">
    ${rects.join('')}
    ${dayTexts}
    ${monthTexts}
</svg>`;
        lastChartFetch = now;
        return cached2026Svg;
    } catch (err) {
        console.error('Error generating 2026 github chart:', err);
        if (cached2026Svg) return cached2026Svg;
        throw err;
    }
}

app.get('/api/github-chart', async (req, res) => {
    try {
        const svg = await generate2026GithubChart();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(svg);
    } catch (error) {
        console.error('Error serving github chart:', error);
        res.status(500).send('<svg></svg>');
    }
});

// Contact form route
app.post('/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;

        // Create transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // Email content
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_TO,
            subject: `Portfolio Contact: Message from ${name}`,
            html: `
                <h3>New Contact Form Submission</h3>
                <p><strong>Name:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <p><strong>Message:</strong></p>
                <p>${message}</p>
            `,
            replyTo: email
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Portfolio server running on http://localhost:${PORT}`);
});
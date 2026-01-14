import https from 'https';
import fs from 'fs';
import path from 'path';
import express, {Request, Response, NextFunction} from 'express';
import helmet from 'helmet';
import selfsigned from 'selfsigned';
import {App} from '@slack/bolt';
import {config} from './config';

const certsDir = path.join(__dirname, '..', 'certs');
const certPath = path.join(certsDir, 'cert.pem');
const keyPath = path.join(certsDir, 'key.pem');

function ensureCertsExist() {
    if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir);
    }

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return; // Certs already exist
    }

    console.log('Generating self-signed SSL certificate...');
    const pems = selfsigned.generate(
        [{name: 'commonName', value: 'localhost'}],
        {days: 365}
    );

    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);
    console.log('SSL certificate generated.');
}

function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.get('X-API-Key');
    if (apiKey && apiKey === config.apiKey) {
        return next();
    }
    return res.status(401).send('Unauthorized');
}

export async function startApiServer(slackApp: App) {
    if (!config.apiKey) {
        console.warn('API_KEY is not set. API server will not start.');
        return;
    }

    ensureCertsExist();

    const api = express();
    api.use(helmet());
    api.use(express.json());

    api.post('/api/message', apiKeyAuth, async (req, res) => {
        const {channel, text} = req.body;

        if (!channel || !text) {
            return res.status(400).send('Missing "channel" or "text" in request body.');
        }

        try {
            await slackApp.client.chat.postMessage({
                channel: channel,
                text: text,
            });
            res.status(200).send({success: true, message: `Message sent to ${channel}`});
        } catch (error: any) {
            console.error('API Error sending Slack message:', error);
            res.status(500).send({success: false, error: error.message});
        }
    });

    const [key, cert] = await Promise.all([
        fs.promises.readFile(keyPath),
        fs.promises.readFile(certPath),
    ]);

    const httpsServer = https.createServer(
        {key, cert},
        api
    );

    httpsServer.listen(config.apiPort, () => {
        console.log(`HTTPS API server running on port ${config.apiPort}`);
    });
} 
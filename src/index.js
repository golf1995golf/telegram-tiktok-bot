import {escapeStr, getVideoUrl} from './utils';
import {deleteMessage, sendImages, sendMessage, sendVideo} from './tg_api'

export default {
    async fetch(request, env, context) {
        return await handleRequest(request, env, context)
    }
}

const DELETE_ORIGINAL_MESSAGE = true; // Delete message with tiktok link(s) after successful uploading or not

async function ttHandler(token, message) {
    const chatId = message.chat.id;
    const messageId = message.message_id;
    if (!message.text) return;

    const tiktok_links = message.text.match(/https?:\/\/(?:(?:vt|vm|www).)?tiktok\.com\/(?:@[a-zA-Z0-9-_.]+\/video\/\d{17,}|[a-zA-Z0-9-_]{8,10})/g);
    if (!tiktok_links) return;

    console.log(`Got ${tiktok_links.length} tt links.`);
    for (let link of tiktok_links) {
        console.log(`Downloading ${link}...`);
        if (!link) continue;

        let tikwm_req = await fetch("https://tikwm.com/api/", {
            body: `url=${encodeURIComponent(link)}&web=1&hd=1&count=0`,
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}
        });
        let tikwm_resp;
        try {
            tikwm_resp = await tikwm_req.json();
            if (!tikwm_resp || !tikwm_resp.data || !tikwm_resp.data.hdplay) continue;
        } catch (e) {
            console.error(e);
            console.log(await tikwm_req.text());
            continue;
        }

        const videoUrl = await getVideoUrl(tikwm_resp);
        if (!videoUrl) {
            await sendMessage(token, chatId, "Video is over 20 MB and cannot be uploaded.", messageId);
            continue;
        }

        let caption = `Sent by: [${escapeStr(message.from.first_name)}](tg://user?id=${message.from.id})\n` +
            `[Original link](${escapeStr(link)})`;
        if (tikwm_resp.data.title)
            caption += `\n\n||${escapeStr(tikwm_resp.data.title)}||`;

        console.log(`Sending video/audio to telegram...`);
        let tg_req = await sendVideo(token, chatId, videoUrl, caption);
        let tg_resp = await tg_req.json();
        if (!tg_resp.ok) {
            console.error(`Error: ${tg_resp.description} (${JSON.stringify(tg_resp)})`);
            if (tg_resp.error_code !== 401)
                await sendMessage(token, chatId, "Error: " + tg_resp.description, messageId);
            else
                return; // Invalid token provided
        }

        if (tikwm_resp.data.images) {
            console.log(`Sending images to telegram...`);
            let images = tikwm_resp.data.images;
            for (let i = 0; i < images.length; i += 10) {
                await sendImages(token, chatId, images.slice(i, i + 10), caption);
            }
        }

        if (DELETE_ORIGINAL_MESSAGE && tg_resp.ok) await deleteMessage(token, chatId, messageId);
    }
}

async function handleRequest(request, env, ctx) {
    if (request.method !== "POST") {
        return new Response("", {status: 405});
    }
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return new Response("", {status: 400});
    }
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (secret !== env.SECRET_KEY) {
        return new Response("", {status: 401});
    }
    let json = await request.json();
    if (!json.message)
        return new Response("");

    if (!json.message.text && json.message.caption) json.message.text = json.message.caption;

    const pattern = new URLPattern({ pathname: '/:bot_token/tt_bot' });
    const req = pattern.exec(request.url).pathname.groups;

    ctx.waitUntil(ttHandler(req.bot_token, json.message));
    return new Response("");
}
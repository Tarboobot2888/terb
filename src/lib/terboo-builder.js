/**
 * Do not remove this watermark.
 *
 * NIXCODE - Advanced WhatsApp Interactive Message Builder
 * Built for creating buttons, carousels, native flows,
 * and AI rich response payloads using Baileys with
 * fluent chaining, flexible payload customization,
 * and scalable architecture for modern bot development.
 *
 * Runtime:
 * - Baileys: @whiskeysockets/baileys (latest)
 *
 * Created by Nixel
 * Contributors: ~ Ahmad tumbuh kembang
 *
 * WhatsApp: wa.me/6285188349341
 * Channel: https://whatsapp.com/channel/0029VbCV1ck8fewpdNb2TY2k
 *
 * Copyright (c) 2026 Nixel
 *
 * Permission is granted to use and modify this library
 * for personal or commercial projects.
 *
 * Reuploading, reselling, relicensing, or redistributing
 * this library as a standalone product is prohibited.
 *
 * Do not claim this project as your own original work.
 */

'use strict';

const VERSION = '4.6';

import { generateWAMessageFromContent, prepareWAMessageMedia } from '@whiskeysockets/baileys';
import { HIGHLIGHT, buildRichContent, detectLanguage, normalizeLanguage, tokenize } from './terboo-rich-response.js';
import { localizeParts, sendRich } from './terboo-code-renderer.js';
import { recipientLanguage } from './terboo-i18n/runtime.js';
import { getDatabase } from './terboo-database.js';
import crypto from 'crypto';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, Readable } from 'stream';

function extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
    if (!extract) {
        return {
            text,
            ie: [],
            inline_entities: [],
        };
    }

    const createIE = (type, ie) => {
        if (type == 'hyperlink') {
            return {
                key: ie.key,
                metadata: {
                    display_name: ie.text,
                    is_trusted: ie.is_trusted,
                    url: ie.url,
                    __typename: 'GenAIInlineLinkItem',
                },
            };
        }

        if (type == 'citation') {
            return {
                key: ie.key,
                metadata: {
                    reference_id: ie.reference_id,
                    reference_url: ie.url,
                    reference_title: ie.url,
                    reference_display_name: ie.url,
                    sources: [],
                    __typename: 'GenAISearchCitationItem',
                },
            };
        }

        if (type == 'latex') {
            return {
                key: ie.key,
                metadata: {
                    latex_expression: ie.text,
                    latex_image: {
                        url: ie.url,
                        width: Number(ie.width) || 100,
                        height: Number(ie.height) || 100,
                    },
                    font_height: Number(ie.font_height) || 83.333333333333,
                    padding: Number(ie.padding) || 15,
                    __typename: 'GenAILatexItem',
                },
            };
        }
    };

    let ie = [];
    let inline_entities = [];
    let result = '';
    let last = 0;
    let citation_index = 1;
    let hyperlink_index = 0;
    let latex_index = 0;
    let stack = [];

    for (let i = 0; i < text.length; i++) {
        if (text[i] == '[' && text[i - 1] != '\\') {
            stack.push(i);
        } else if (text[i] == ']' && (text[i + 1] == '(' || text[i + 1] == '<')) {
            let start = stack.pop();

            if (start == null) continue;

            let open = text[i + 1];
            let close = open == '(' ? ')' : '>';
            let type = open == '(' ? 'link' : 'latex';
            let end = i + 2;
            let depth = 1;

            while (end < text.length && depth) {
                if (text[end] == open && text[end - 1] != '\\') depth++;
                else if (text[end] == close && text[end - 1] != '\\') depth--;
                end++;
            }

            if (depth) continue;

            let raw = text.slice(start + 1, i).trim();
            let url = text.slice(i + 2, end - 1).trim();

            let key;
            let tag;
            let data;

            if (type == 'latex') {
                if (!latex) continue;

                let [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|');

                key = `\u004E\u0049\u0058\u0045\u004C_LATEX_${latex_index++}`;
                tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;

                data = {
                    type: 'latex',
                    ie: {
                        key,
                        text: txt,
                        url,
                        width,
                        height,
                        font_height,
                        padding,
                    },
                };
            } else if (raw) {
                if (!hyperlink) continue;

                const trusted = !url.startsWith('!');

                if (!trusted) {
                    url = url.slice(1);
                }

                key = `\u004E\u0049\u0058\u0045\u004C_HYPERLINK_${hyperlink_index++}`;
                tag = `{{${key}}}${url}{{/${key}}}`;

                data = {
                    type: 'hyperlink',
                    ie: {
                        key,
                        text: raw,
                        url,
                        is_trusted: trusted,
                    },
                };
            } else {
                if (!citation) continue;

                key = `\u004E\u0049\u0058\u0045\u004C_CITATION_${citation_index - 1}`;
                tag = `{{${key}}}${url}{{/${key}}}`;

                data = {
                    type: 'citation',
                    ie: {
                        reference_id: citation_index++,
                        key,
                        text: '',
                        url,
                    },
                };
            }

            result += text.slice(last, start) + tag;
            last = end;

            ie.push(data);

            const entity = createIE(data.type, data.ie);

            if (entity) {
                inline_entities.push(entity);
            }

            i = end - 1;
        }
    }

    result += text.slice(last);

    return {
        text: result,
        ie,
        inline_entities,
    };
}

async function waitAllPromises(input) {
    const isPromise = (v) => v && typeof v.then === 'function';
    const isObject = (v) => v && typeof v === 'object';

    const deep = async (v) => {
        if (isPromise(v)) return deep(await v);
        if (Array.isArray(v)) return Promise.all(v.map(deep));
        if (isObject(v)) {
            const entries = await Promise.all(Object.entries(v).map(async ([k, val]) => [k, await deep(val)]));
            return Object.fromEntries(entries);
        }
        return v;
    };

    return deep(await input);
}

class Toolkit {
    constructor() { }

    static extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
        return extractIE(text, { extract, hyperlink, citation, latex });
    }

    static async resize(buffer, x, y, fit = 'cover') {
        return await sharp(buffer)
            .resize(x, y, {
                fit,
                position: 'center',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
    }

    static async waitAllPromises(input) {
        return await waitAllPromises(input);
    }

    static async fetchBuffer(url, options = {}, { silent = true } = {}) {
        try {
            let response = await fetch(url, options);
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if (silent) return Buffer.alloc(0);
            throw error;
        }
    }

    static async toUrl(_client, path, mediaType = 'document') {
        if (!path) throw new Error('Url or buffer needed');

        const media = await prepareWAMessageMedia(
            {
                [mediaType]: Buffer.isBuffer(path) ? path : { url: path },
            },
            {
                upload: _client.waUploadToServer,
                jid: '\u0040\u006e\u0065\u0077\u0073\u006c\u0065\u0074\u0074\u0065\u0072',
            }
        );

        return Object.values(media)[0]?.url;
    }

    static async resolveMedia(_client, media, mediaType = 'image', { resolveUrl = false, resolveWAUrl = false, result = 'url', resize = false, width = 300, height = 300 } = {}) {
        const isUrl = (str) => /^https?:\/\/.+/i.test(str);

        const isWAUrl = (str) => /^https?:\/\/[^/]*\.whatsapp\.net\//i.test(str);

        if (Array.isArray(media)) {
            return Promise.all(
                media.map((item) =>
                    Toolkit.resolveMedia(_client, item, mediaType, {
                        resolveUrl,
                        resolveWAUrl,
                        result,
                        resize,
                        width,
                        height,
                    })
                )
            );
        }

        const originalIsBuffer = Buffer.isBuffer(media);

        if (typeof media === 'string' && isUrl(media)) {
            if (isWAUrl(media)) {
                if (resolveWAUrl) {
                    media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                } else if (!resolveUrl) {
                    if (result === 'url') return media;

                    media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                }
            } else {
                if (!resolveUrl) {
                    if (result === 'url') return media;

                    media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                } else {
                    media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                }
            }
        }

        if (typeof media === 'string' && !isUrl(media)) {
            media = Buffer.from(media, 'base64');
        }

        if (!Buffer.isBuffer(media) || !media.length) {
            return;
        }

        if (resize && Buffer.isBuffer(media)) {
            media = await Toolkit.resize(media, width, height);
        }

        if (result === 'buffer') {
            return media;
        }

        if (result === 'base64') {
            return media.toString('base64');
        }

        if (originalIsBuffer) {
            return Toolkit.toUrl(_client, media, mediaType);
        }

        return Toolkit.toUrl(_client, media, mediaType);
    }

    static getMp4Duration(buffer, { silent = true } = {}) {
        try {
            if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
                if (silent) return 0;
                throw new Error('Invalid buffer');
            }

            let offset = 0;

            while (offset < buffer.length - 8) {
                const size = buffer.readUInt32BE(offset);

                if (size < 8 || offset + size > buffer.length) {
                    if (silent) return 0;
                    throw new Error('Invalid atom size');
                }

                const type = buffer.toString('ascii', offset + 4, offset + 8);

                if (type === 'moov') {
                    let moovOffset = offset + 8;
                    const moovEnd = offset + size;

                    while (moovOffset < moovEnd - 8) {
                        const childSize = buffer.readUInt32BE(moovOffset);

                        if (childSize < 8 || moovOffset + childSize > moovEnd) {
                            if (silent) return 0;
                            throw new Error('Invalid child atom size');
                        }

                        const childType = buffer.toString('ascii', moovOffset + 4, moovOffset + 8);

                        if (childType === 'mvhd') {
                            const version = buffer.readUInt8(moovOffset + 8);

                            if (version === 0) {
                                const timescale = buffer.readUInt32BE(moovOffset + 20);
                                const duration = buffer.readUInt32BE(moovOffset + 24);

                                if (!timescale) {
                                    if (silent) return 0;
                                    throw new Error('Invalid timescale');
                                }

                                return duration / timescale;
                            }

                            if (version === 1) {
                                const timescale = buffer.readUInt32BE(moovOffset + 32);
                                const duration = Number(buffer.readBigUInt64BE(moovOffset + 36));

                                if (!timescale) {
                                    if (silent) return 0;
                                    throw new Error('Invalid timescale');
                                }

                                return duration / timescale;
                            }
                        }

                        moovOffset += childSize;
                    }
                }

                offset += size;
            }

            if (silent) return 0;

            throw new Error('No mvhd found!');
        } catch (err) {
            if (silent) return 0;
            throw err;
        }
    }

    static getMp4Preview(videoBuffer, { time, result = 'buffer', resize = true, width = 300, height = 300, silent = true } = {}) {
        return new Promise((resolve, reject) => {
            const fail = (err) => {
                if (silent) {
                    return resolve(result === 'base64' ? '' : Buffer.alloc(0));
                }
                return reject(err);
            };

            try {
                if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
                    return fail(new Error('videoBuffer tidak valid atau kosong'));
                }

                const inputStream = new Readable({ read() { } });
                inputStream.push(videoBuffer);
                inputStream.push(null);

                const outputStream = new PassThrough();
                const chunks = [];

                outputStream.on('data', (chunk) => chunks.push(chunk));

                outputStream.on('end', async () => {
                    try {
                        let output = Buffer.concat(chunks);

                        if (!output.length) {
                            return fail(new Error('Output kosong — cek format atau timestamp video'));
                        }

                        if (resize) {
                            output = await Toolkit.resize(output, width, height);
                        }

                        return resolve(result === 'base64' ? output.toString('base64') : output);
                    } catch (err) {
                        return fail(err);
                    }
                });

                outputStream.on('error', fail);

                time ??= Math.min(Toolkit.getMp4Duration(videoBuffer) * 0.2, 10);

                ffmpeg(inputStream)
                    .outputOptions([`-ss ${time}`, '-vframes 1', '-vcodec png', '-f image2pipe'])
                    .on('error', (err) => fail(new Error(`ffmpeg error: ${err.message}`)))
                    .pipe(outputStream, { end: true });
            } catch (err) {
                return fail(err);
            }
        });
    }
}

class BaseBuilder {
    constructor() {
        this._title = '';
        this._subtitle = '';
        this._body = '';
        this._footer = '';
        this._contextInfo = {};
        this._extraPayload = {};
    }

    setTitle(title) {
        if (typeof title !== 'string') {
            throw new TypeError('Title must be a string');
        }
        this._title = title;
        return this;
    }

    setSubtitle(subtitle) {
        if (typeof subtitle !== 'string') {
            throw new TypeError('Subtitle must be a string');
        }
        this._subtitle = subtitle;
        return this;
    }

    setBody(body) {
        if (typeof body !== 'string') {
            throw new TypeError('Body must be a string');
        }
        this._body = body;
        return this;
    }

    setFooter(footer) {
        if (typeof footer !== 'string') {
            throw new TypeError('Footer must be a string');
        }
        this._footer = footer;
        return this;
    }

    setContextInfo(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('ContextInfo must be a plain object');
        }

        this._contextInfo = obj;
        return this;
    }

    addPayload(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Payload must be a plain object');
        }

        Object.assign(this._extraPayload, obj);

        return this;
    }
}

class Button extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }
        this.#client = client;

        this._buttons = [];
        this._data;
        this._currentSelectionIndex = -1;
        this._currentSectionIndex = -1;
        this._params = {};
    }

    setVideo(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { video: path, ...options }) : (this._data = { video: { url: path }, ...options });
        return this;
    }

    setImage(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { image: path, ...options }) : (this._data = { image: { url: path }, ...options });
        return this;
    }

    setDocument(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { document: path, ...options }) : (this._data = { document: { url: path }, ...options });
        return this;
    }

    setMedia(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }

        this._data = obj;
        return this;
    }

    clearButtons() {
        this._buttons = [];
        return this;
    }

    setParams(obj) {
        this._params = obj;
        return this;
    }

    addButton(name, params) {
        this._buttons.push({
            name,
            buttonParamsJson: typeof params === 'string' ? params : JSON.stringify(params),
        });

        return this;
    }

    makeRow(header = '', title = '', description = '', id = '') {
        if (this._currentSelectionIndex === -1 || this._currentSectionIndex === -1) {
            throw new Error('You need to create a selection and a section first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections[this._currentSectionIndex].rows.push({ header, title, description, id });
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    makeSection(title = '', highlight_label = '') {
        if (this._currentSelectionIndex === -1) {
            throw new Error('You need to create a selection first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections.push({ title, highlight_label, rows: [] });
        this._currentSectionIndex = buttonParams.sections.length - 1;
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    addSelection(title, options = {}) {
        this._buttons.push({ ...options, name: 'single_select', buttonParamsJson: JSON.stringify({ title, sections: [] }) });
        this._currentSelectionIndex = this._buttons.length - 1;
        this._currentSectionIndex = -1;
        return this;
    }

    addReply(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addCall(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addReminder(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_reminder',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addCancelReminder(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_cancel_reminder',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addAddress(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'address_message',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addLocation(options = {}) {
        this._buttons.push({
            name: 'send_location',
            buttonParamsJson: JSON.stringify(options),
        });
        return this;
    }

    addUrl(display_text = '', url = '', webview_interaction = false, options = {}) {
        this._buttons.push({
            ...options,
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text,
                url,
                webview_interaction,
                ...options,
            }),
        });
        return this;
    }

    addCopy(display_text = '', copy_code = '', options = {}) {
        this._buttons.push({
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text,
                copy_code,
                ...options,
            }),
        });
        return this;
    }

    static paramsList = {
        limited_time_offer: {
            text: 'string',
            url: 'string',
            copy_code: 'string',
            expiration_time: 'number',
        },
        bottom_sheet: {
            in_thread_buttons_limit: 'number',
            divider_indices: ['number'],
            list_title: 'string',
            button_title: 'string',
        },
        tap_target_configuration: {
            title: 'string',
            description: 'string',
            canonical_url: 'string',
            domain: 'string',
            buttonIndex: 'number',
        },
    };

    async toCard() {
        return {
            body: {
                text: this._body,
            },
            footer: {
                text: this._footer,
            },
            header: {
                title: this._title,
                subtitle: this._subtitle,
                hasMediaAttachment: !!this._data,
                ...(this._data
                    ? await prepareWAMessageMedia(this._data, { upload: this.#client.waUploadToServer }).catch((e) => {
                        if (String(e).includes('Invalid media type')) return this._data;
                        throw e;
                    })
                    : {}),
            },
            nativeFlowMessage: {
                messageParamsJson: JSON.stringify(this._params),
                buttons: this._buttons,
            },
        };
    }

    async build(jid, { ...options } = {}) {
        const message = await this.toCard();

        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    ...message,
                    contextInfo: this._contextInfo,
                },
            },
            { ...options }
        );
    }

    async send(jid, { ...options } = {}) {
        const msg = await this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

class ButtonV2 extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }

        this.#client = client;
        this._image;
        this._data;
        this._buttons = [];
    }

    addButton(displayText = '', buttonId = crypto.randomUUID()) {
        this._buttons.push({
            buttonId,
            buttonText: { displayText },
            type: 1,
        });
        return this;
    }

    addRawButton(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Buttons must be a plain object');
        }

        this._buttons.push(obj);
        return this;
    }

    setThumbnail(path) {
        if (!path) throw new Error('Url or buffer needed');
        this._image = path;
        return this;
    }

    setMedia(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }

        this._data = obj;
        return this;
    }

    async build(jid, { ...options } = {}) {
        let _thumbnail = this._image ? await Toolkit.resize(Buffer.isBuffer(this._image) ? this._image : await Toolkit.fetchBuffer(this._image, {}, { silent: true }), 300, 300) : null;
        const msg = generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                buttonsMessage: {
                    contentText: this._body,
                    footerText: this._footer,
                    ...(this._data
                        ? this._data
                        : {
                            headerType: 6,
                            locationMessage: {
                                degreesLatitude: 0,
                                degreesLongitude: 0,
                                name: this._title,
                                address: this._subtitle,
                                jpegThumbnail: _thumbnail,
                            },
                        }),
                    viewOnce: true,
                    contextInfo: this._contextInfo,
                    buttons: [...this._buttons],
                },
            },
            { ...options }
        );
        return msg;
    }

    async send(jid, { ...options } = {}) {
        if (this._buttons.length < 1) throw new Error('ButtonV2 requires at least one button');
        const msg = await this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

class Carousel extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }

        this.#client = client;
        this._cards = [];
    }

    addCard(card) {
        const cards = Array.isArray(card) ? card : [card];
        const baseIndex = this._cards.length;

        for (const [index, c] of cards.entries()) {
            if (!c?.header?.hasMediaAttachment) {
                throw new Error(`Card [${baseIndex + index}] must include an image or video in header`);
            }
        }

        this._cards.push(...cards);
        return this;
    }

    build(jid, { ...options } = {}) {
        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    header: {
                        hasMediaAttachment: false,
                    },
                    body: { text: this._body },
                    footer: { text: this._footer },
                    contextInfo: this._contextInfo,
                    carouselMessage: {
                        cards: this._cards,
                    },
                },
            },
            { ...options }
        );
    }

    async send(jid, { ...options } = {}) {
        const msg = this.build(jid, options);

        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

/**
 * AIRich — نفس واجهة المُنشئ السابق (addText/addCode/addTable/addTip/addVideo/… ثم send)،
 * لكنه يبني الرد عبر Rich Response Engine (v4 §4، §44):
 *   • بلا انتحال Meta AI: لا forwardedAiBotMessageInfo ولا botForwardedMessage ولا botMetadata.
 *   • الكود حرفياً مع تلوين (tokenize بلا فقد)، والجداول جداول حقيقية.
 *   • الصور/الفيديو رسائل واتساب عادية في موضعها من الترتيب.
 *   • رفض جهاز المستلم للعرض الغني ⇒ بطاقة نصية أحادية المسافة تلقائياً.
 */
class AIRich extends BaseBuilder {
    #client;

    constructor(client) {
        if (!client) {
            throw new Error('Socket is required');
        }

        super();
        this.#client = client;
        this._parts = [];
        this._sections = [];
    }

    addSubmessage(submessage) {
        const items = Array.isArray(submessage) ? submessage : [submessage];

        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Submessage must be a plain object or array of plain objects');
            }

            if (item.messageType === 2 && typeof item.messageText === 'string') {
                this._parts.push({ type: 'text', text: item.messageText });
            } else if (item.messageType === 4 && item.tableMetadata?.rows) {
                this._parts.push({ type: 'table', title: item.tableMetadata.title || '', rows: item.tableMetadata.rows });
            } else if (item.messageType === 5 && item.codeMetadata?.codeBlocks) {
                const code = item.codeMetadata.codeBlocks.map((block) => block.codeContent ?? '').join('');
                this._parts.push({ type: 'code', code, language: detectLanguage(code, { fence: item.codeMetadata.codeLanguage || '' }).language });
            } else if (item.messageType === 8 && item.latexMetadata) {
                this._parts.push({ type: 'latex', text: item.latexMetadata.text || '', expressions: item.latexMetadata.expressions || [] });
            } else {
                console.warn(`[AIRich] نوع submessage غير مدعوم في العرض الغني: ${item.messageType}`);
            }
        }

        return this;
    }

    /** أقسام unifiedResponse (مخطط Meta الداخلي) لا تُرسل؛ يُستخرج نصها فقط إن وُجد */
    addSection(section) {
        const items = Array.isArray(section) ? section : [section];

        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Section must be a plain object or array of plain objects');
            }

            this._sections.push(item);
            const text = item.view_model?.primitive?.text;
            if (typeof text === 'string' && text.trim()) this._parts.push({ type: 'text', text });
        }

        return this;
    }

    addText(text) {
        if (typeof text != 'string') {
            throw new TypeError('Text must be a string');
        }

        this._parts.push({ type: 'text', text });
        return this;
    }

    addCode(language, code) {
        if (typeof language !== 'string' || typeof code !== 'string') {
            throw new TypeError('Language and code must be a string');
        }

        this._parts.push({ type: 'code', code, language: detectLanguage(code, { fence: language }).language });
        return this;
    }

    addTable(table, { hyperlink = true, citation = true, latex = true } = {}) {
        if (!Array.isArray(table)) {
            throw new TypeError('Table must be an array');
        }

        const meta = AIRich.toTableMetadata(table, { hyperlink, citation, latex });
        this._parts.push({ type: 'table', title: meta.title, rows: meta.rows });
        return this;
    }

    addSource(sources = []) {
        if (!(Array.isArray(sources) && (sources.every((item) => typeof item === 'string') || sources.every((item) => Array.isArray(item) && item.every((v) => typeof v === 'string'))))) {
            throw new TypeError('Sources must be a string array or an array of string arrays');
        }

        const list = sources.every((item) => typeof item === 'string') ? [sources] : sources;
        const lines = list.map(([, url, text]) => `> ◈ ${text || url || ''}${text && url ? `: ${url}` : ''}`).filter((line) => line.trim() !== '> ◈');
        if (lines.length) this._parts.push({ type: 'text', text: lines.join('\n') });
        return this;
    }

    addReels(reelsItems = []) {
        if (!Array.isArray(reelsItems)) {
            throw new TypeError('Reels items must be an array');
        }

        for (const item of reelsItems) {
            const url = item?.videoUrl ?? item?.url;
            if (url) this._parts.push({ type: 'media', kind: 'video', source: Buffer.isBuffer(url) ? url : { url: String(url) }, caption: item.username || item.title || '' });
        }

        return this;
    }

    #media(kind, value, label) {
        const isObject = (v) => v && typeof v === 'object' && !Buffer.isBuffer(v) && v.url;
        const valid = typeof value === 'string' || Buffer.isBuffer(value) || isObject(value)
            || (Array.isArray(value) && value.every((v) => typeof v === 'string' || Buffer.isBuffer(v) || isObject(v)));
        if (!valid) {
            throw new TypeError(`${label} must be string | buffer | object | array`);
        }

        for (const item of Array.isArray(value) ? value : [value]) {
            const source = Buffer.isBuffer(item) ? item : { url: String(isObject(item) ? item.url : item) };
            this._parts.push({ type: 'media', kind, source, caption: isObject(item) ? item.caption || '' : '' });
        }

        return this;
    }

    addImage(imageUrl) {
        return this.#media('image', imageUrl, 'imageUrl');
    }

    addVideo(videoUrl) {
        return this.#media('video', videoUrl, 'videoUrl');
    }

    addProduct(data = {}) {
        if (!((data && typeof data === 'object' && !Array.isArray(data)) || (Array.isArray(data) && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))))) {
            throw new TypeError('Product items must be an object or an array of objects');
        }

        for (const item of Array.isArray(data) ? data : [data]) {
            const image = item.image_url ?? item.image;
            if (image) this.#media('image', image, 'image');
            const price = item.sale_price ?? item.price;
            const lines = [item.title && `*${item.title}*`, item.brand && `> ◈ ${item.brand}`, price != null && `> ◈ ${price}`, (item.product_url ?? item.url) && `> ◈ ${item.product_url ?? item.url}`].filter(Boolean);
            if (lines.length) this._parts.push({ type: 'text', text: lines.join('\n') });
        }

        return this;
    }

    addPost(data = {}) {
        if (!((data && typeof data === 'object' && !Array.isArray(data)) || (Array.isArray(data) && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))))) {
            throw new TypeError('Post items must be an object or an array of objects');
        }

        for (const post of Array.isArray(data) ? data : [data]) {
            const image = post.thumbnail_url ?? post.image_url ?? post.image;
            if (image) this.#media('image', image, 'image');
            const lines = [post.title && `*${post.title}*`, post.subtitle, post.username && `> ◈ ${post.username}`, post.url && `> ◈ ${post.url}`].filter(Boolean);
            if (lines.length) this._parts.push({ type: 'text', text: lines.join('\n') });
        }

        return this;
    }

    addTip(text) {
        if (typeof text !== 'string') {
            throw new TypeError('Tip must be a string');
        }

        this._parts.push({ type: 'text', text: `> ◈ ${text}` });
        return this;
    }

    addSuggest(suggestion) {
        if (!(typeof suggestion === 'string' || (Array.isArray(suggestion) && suggestion.every((v) => typeof v === 'string')))) {
            throw new TypeError('Suggestion must be a string or array of strings');
        }

        const list = Array.isArray(suggestion) ? suggestion : [suggestion];
        this._parts.push({ type: 'text', text: list.map((item) => `> ◈ ${item}`).join('\n') });
        return this;
    }

    /** الأجزاء النهائية بالترتيب: العنوان ثم المحتوى ثم التذييل */
    parts() {
        return [
            ...(this._title ? [{ type: 'text', text: `*${this._title}*` }] : []),
            ...this._parts,
            ...(this._footer ? [{ type: 'text', text: `> ${this._footer}` }] : []),
        ];
    }

    /** محتوى رسالة غنية (بلا الوسائط) جاهز لـ relayMessage — بلا أي هوية بوت ذكاء */
    async build({ quoted } = {}) {
        return {
            ...buildRichContent(this.parts().filter((part) => part.type !== 'media'), { quoted }),
            ...this._extraPayload,
        };
    }

    /**
     * @param {string} jid
     * @param {{quoted?:Object, lang?:string, raw?:boolean}} [options]
     *   raw ⇒ نص حر (ردود الذكاء) يُرسل كما هو بلا ترجمة؛ غير ذلك تُترجم نصوص البلوقن للغة المستلم.
     */
    async send(jid, { quoted, lang, raw = false, ...options } = {}) {
        const language = lang || recipientLanguage(jid, quoted ? { quoted, ...options } : options, AIRich.database());
        const parts = raw ? this.parts() : localizeParts(this.parts(), language);
        return sendRich(this.#client, jid, parts, { quoted: quoted || null, lang: language, label: 'rich' });
    }

    /** قاعدة البيانات للغة المستلم؛ قبل تهيئتها (اختبارات/أدوات) تُستعمل اللغة الافتراضية */
    static database() {
        try {
            return getDatabase();
        } catch (error) {
            if (!AIRich.warnedDatabase) console.warn('[AIRich] قاعدة البيانات غير مهيأة، لغة الرد الافتراضية:', error.message);
            AIRich.warnedDatabase = true;
            return null;
        }
    }

    /** نفس شكل المُنشئ السابق: codeBlock للبروتو (تلوين بلا فقد) */
    static tokenizer(code, lang = 'javascript') {
        const language = normalizeLanguage(lang) || detectLanguage(code, { fence: lang }).language;
        const codeBlock = tokenize(code, language);
        return {
            codeBlock,
            unified_codeBlock: codeBlock.map((block) => ({ content: block.codeContent, type: Object.keys(HIGHLIGHT).find((key) => HIGHLIGHT[key] === block.highlightType) || 'DEFAULT' })),
        };
    }
    static toTableMetadata(arr, { hyperlink = true, citation = true, latex = true } = {}) {
        if (!Array.isArray(arr) || !arr.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))) {
            throw new TypeError('Table must be a nested array of strings');
        }

        const [header, ...rows] = arr;

        const maxLen = Math.max(header.length, ...rows.map((r) => r.length));

        const normalize = (r) => [...r, ...Array(maxLen - r.length).fill('')];

        const unified_rows = [
            {
                is_header: true,
                cells: normalize(header),
            },
            ...rows.map((r) => ({
                is_header: false,
                cells: normalize(r),
            })),
        ].map((row) => {
            const markdown_cells = row.cells.map((cell) => {
                const extracted = extractIE(cell, { hyperlink, citation, latex });

                return {
                    text: extracted.text,
                    ...(extracted.inline_entities.length ? { inline_entities: extracted.inline_entities } : {}),
                };
            });

            return {
                ...row,
                ...(markdown_cells.some((c) => c.inline_entities?.length) ? { markdown_cells } : {}),
            };
        });

        const rowsMeta = unified_rows.map((r) => ({
            items: r.cells,
            ...(r.is_header ? { isHeading: true } : {}),
        }));

        return {
            title: '',
            rows: rowsMeta,
            unified_rows,
        };
    }

    static newLayout(name, data, extra = {}) {
        return {
            ...extra,
            view_model: {
                [Array.isArray(data) ? 'primitives' : 'primitive']: data,
                __typename: `GenAI${name}LayoutViewModel`,
            },
        };
    }
}

export { VERSION, Button, ButtonV2, Carousel, AIRich, Toolkit };
require("events").EventEmitter.defaultMaxListeners = 960;
require("./utils/mdHelpers");

const {
    default: giftedConnect,
    isJidGroup,
    jidNormalizedUser,
    isJidBroadcast,
    downloadMediaMessage,
    downloadContentFromMessage,
    getContentType,
    fetchLatestWaWebVersion,
} = require("@whiskeysockets/baileys");

const {
    evt,
    logger,
    emojis,
    commands,
    setSudo,
    delSudo,
    TechApi,
    ApiKey,
    AutoReact,
    AntiLink,
    Antibad,
    AntiGroupMention,
    AutoBio,
    handleGameMessage,
    ChatBot,
    loadSession,
    useSQLiteAuthState,
    getMediaBuffer,
    getSudoNumbers,
    getFileContentType,
    bufferToStream,
    uploadToPixhost,
    uploadToImgBB,
    setCommitHash,
    getCommitHash,
    mdBuffer,
    mdJson,
    formatAudio,
    formatVideo,
    toAudio,
    uploadToGithubCdn,
    uploadToCyberCdn,
    uploadToCatbox,
    Anticall,
    createContext,
    createContext2,
    verifyJidState,
    Presence,
    AntiDelete,
    AntiEdit,
    syncDatabase,
    initializeSettings,
    initializeGroupSettings,
    getAllSettings,
    DEFAULT_SETTINGS,
    standardizeJid,
    serializeMessage,
    loadPlugins,
    findCommand,
    findBodyCommand,
    createHelpers,
    getGroupInfo,
    buildSuperUsers,
    getGroupMetadata,
    createSocketConfig,
    safeNewsletterFollow,
    safeGroupAcceptInvite,
    setupConnectionHandler,
    setupGroupEventsListeners,
    initializeLidStore,
} = require("./utils");

const {
    saveAntiDelete,
    findAntiDelete,
    removeAntiDelete,
    startCleanup,
    SQLiteStore,
} = require('./utils/database/messageStore');

const config = require("./config");
const googleTTS = require("google-tts-api");
const fs = require("fs-extra");
const path = require("path");
const axios = require('axios');
const express = require("express");

/**
 * Resolves any JID to a real phone JID (@s.whatsapp.net).
 * Returns the original jid unchanged if it is already a real JID.
 * Returns null only when jid itself is null/undefined.
 * When a LID cannot be resolved it returns the original LID as a best-effort
 * fallback so the operation still fires rather than being silently skipped.
 */
async function resolveRealJid(Cyber, jid) {
    if (!jid) return null;
    if (!jid.endsWith('@lid')) return jid; // already real
    try {
        const { getLidMapping } = require('./utils/connection/groupCache');
        const cached = getLidMapping(jid);
        if (cached) return cached;
    } catch (_) {}
    try {
        const resolved = await Cyber.getJidFromLid(jid);
        if (resolved &&!resolved.endsWith('@lid')) return resolved;
    } catch (_) {}
    try {
        const { getLidMappingFromDb } = require('./utils/database/lidMapping');
        const fromDb = await getLidMappingFromDb(jid);
        if (fromDb) return fromDb;
    } catch (_) {}
    return jid; // best effort — return original LID so the operation still fires
}

const { SESSION_ID: sessionId } = config;
const PORT = process.env.PORT || 5000;
const app = express();
let Cyber;
let store;

logger.level = "silent";
app.use(express.static("public"));
app.get("/", (req, res) => res.sendFile(__dirname + "/public/index.html"));
app.get("/health", (req, res) =>
    res.status(200).json({ status: "alive", uptime: process.uptime() }),
);
app.listen(PORT, () => console.log(`✅ Server Running on Port: ${PORT}`));

setInterval(() => {
    const used = process.memoryUsage();
    if (used.heapUsed > 400 * 1024 * 1024) {
        if (global.gc) global.gc();
    }
}, 60000);

setInterval(async () => {
    try {
        const http = require("http");
        http.get(`http://localhost:${PORT}/health`, () => {});
    } catch (e) {}
}, 240000);

const sessionDir = path.join(__dirname, "session");
const pluginsPath = path.join(__dirname, "plugins");

let botSettings = {};
async function loadBotSettings() {
    await syncDatabase();
    await initializeSettings();
    await initializeGroupSettings();
    botSettings = await getAllSettings();
    return botSettings;
}

startCleanup();

async function startCyber() {
    try {
        const { version } = await fetchLatestWaWebVersion();
        const sessionDbPath = path.join(sessionDir, "session.db");
        const { state, saveCreds } = await useSQLiteAuthState(sessionDbPath);

        if (store) store.destroy();
        store = new SQLiteStore();

        const socketConfig = createSocketConfig(version, state, logger);
        socketConfig.getMessage = async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return { conversation: "Error occurred" };
        };

        Cyber = giftedConnect(socketConfig);
        store.bind(Cyber.ev);

        Cyber.ev.process(async (events) => {
            if (events["creds.update"]) await saveCreds();
        });

        setupAutoReact(Cyber);
        setupAntiDelete(Cyber);
        setupAutoBio(Cyber);
        setupAntiCall(Cyber);
        setupNewsletterReact(Cyber);
        setupPresence(Cyber);
        setupChatBotAndAntiLink(Cyber);
        setupAntiEdit(Cyber);
        setupStatusHandlers(Cyber);
        setupGroupEventsListeners(Cyber);

        loadPlugins(pluginsPath);

        setupCommandHandler(Cyber);

        setupConnectionHandler(Cyber, sessionDir, startCyber, {
            onOpen: async (Cyber) => {
                const s = await getAllSettings();
                await safeNewsletterFollow(Cyber, s.NEWSLETTER_JID);
                await safeGroupAcceptInvite(Cyber, s.GC_JID);
                await initializeLidStore(Cyber);

                setTimeout(async () => {
                    try {
                        const totalCommands = commands.filter(
                            (c) => c.pattern &&!c.dontAddCommandList,
                        ).length;
                        console.log("💜 Connected to Whatsapp, Active!");

                        if (s.STARTING_MESSAGE === "true") {
                            const d = DEFAULT_SETTINGS;
                            const md =
                                s.MODE === "public"? "public" : "private";
                            const connectionMsg = `
*${s.BOT_NAME || d.BOT_NAME} CONNECTED*

Prefix : *[ ${s.PREFIX || d.PREFIX} ]*
Plugins : *${totalCommands}*
Mode : *${md}*
Owner : *${s.OWNER_NUMBER || d.OWNER_NUMBER}*
Tutorials : *${s.YT || d.YT}*
Updates : *${s.NEWSLETTER_URL || d.NEWSLETTER_URL}*

Note: Bot may take some few seconds/minutes to sync before being ready to use.

> *${s.CAPTION || d.CAPTION}*`;

                            await Cyber.sendMessage(
                                Cyber.user.id,
                                {
                                    text: connectionMsg,
                                   ...(await createContext(
                                        s.BOT_NAME || d.BOT_NAME,
                                        {
                                            title: "BOT INTEGRATED",
                                            body: "Status: Ready for Use",
                                        },
                                    )),
                                },
                                {
                                    disappearingMessagesInChat: true,
                                    ephemeralExpiration: 300,
                                },
                            );
                        }
                    } catch (err) {
                        console.error("Post-connection setup error:", err);
                    }
                }, 5000);
            },
        });

        process.on("SIGINT", () => store?.destroy());
        process.on("SIGTERM", () => store?.destroy());
    } catch (error) {
        console.error("Socket initialization error:", error);
        setTimeout(() => startCyber(), 5000);
    }
}

function setupAutoReact(Cyber) {
    Cyber.ev.on("messages.upsert", async (mek) => {
        try {
            const ms = mek.messages[0];
            const s = await getAllSettings();
            const autoReactMode = s.AUTO_REACT || "off";

            if (
                autoReactMode === "off" ||
                autoReactMode === "false" ||
                ms.key.fromMe ||
               !ms.message
            )
                return;

            const from = ms.key.remoteJid;
            const isGroup = from?.endsWith("@g.us");
            const isDm = from?.endsWith("@s.whatsapp.net");

            let shouldReact = false;
            if (autoReactMode === "all" || autoReactMode === "true") {
                shouldReact = true;
            } else if (autoReactMode === "dm" && isDm) {
                shouldReact = true;
            } else if (autoReactMode === "groups" && isGroup) {
                shouldReact = true;
            }

            if (!shouldReact) return;

            const randomEmoji =
                emojis[Math.floor(Math.random() * emojis.length)];
            await AutoReact(randomEmoji, ms, Cyber);
        } catch (err) {
            console.error("Error during auto reaction:", err);
        }
    });
}

function setupAntiDelete(Cyber) {
    const botJid = `${Cyber.user?.id.split(":")[0]}@s.whatsapp.net`;
    const botOwnerJid = botJid;

    const getSender = (ms) => {
        const key = ms.key;
        const realJid = (j) => j &&!j.endsWith('@lid')? j : null;
        return (
            realJid(key.participantPn) ||
            realJid(key.senderPn) ||
            realJid(ms.senderPn) ||
            realJid(key.participant) ||
            realJid(ms.participant) ||
            key.participantPn ||
            key.participant ||
            ms.participant ||
            (key.remoteJid?.endsWith("@g.us")? null : realJid(key.remoteJid) || key.remoteJid)
        );
    };

    const getPushName = (ms) => {
        return (
            ms.pushName || ms.key?.pushName || ms.verifiedBizName || "Unknown"
        );
    };

    const isProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getProtocolMessage = (ms) => {
        return (
            ms.message?.protocolMessage ||
            ms.message?.ephemeralMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessage?.message?.protocolMessage ||
            ms.message?.viewOnceMessageV2?.message?.protocolMessage
        );
    };

    const getActualMessage = (ms) => {
        const msg = ms.message;
        if (!msg) return null;
        return (
            msg.ephemeralMessage?.message ||
            msg.viewOnceMessage?.message ||
            msg.viewOnceMessageV2?.message ||
            msg.documentWithCaptionMessage?.message ||
            msg
        );
    };

    Cyber.ev.on("messages.upsert", async ({ messages }) => {
        for (const ms of messages) {
            try {
                if (!ms?.message) continue;

                const { key } = ms;
                if (
                   !key?.remoteJid ||
                    key.fromMe ||
                    key.remoteJid === "status@broadcast"
                )
                    continue;

                const protocolMsg = getProtocolMessage(ms);
                if (protocolMsg?.type === 0) {
                    const deleteKey = protocolMsg.key;
                    const deletedId = deleteKey?.id;
                    const chatJid = key.remoteJid;

                    if (!deletedId) continue;

                    const deletedMsg = findAntiDelete(chatJid, deletedId);
                    if (!deletedMsg?.message) continue;

                    const deleter = getSender(ms) || key.remoteJid;
                    const deleterPushName = getPushName(ms);

                    if (deleter === botJid || deleter === botOwnerJid) continue;

                    await AntiDelete(
                        Cyber,
                        deletedMsg,
                        key,
                        deleter,
                        deletedMsg.originalSender,
                        botOwnerJid,
                        deleterPushName,
                        deletedMsg.originalPushName,
                    );

                    removeAntiDelete(chatJid, deletedId);
                    continue;
                }

                if (isProtocolMessage(ms)) continue;

                const actualMessage = getActualMessage(ms);
                if (!actualMessage) continue;

                const sender = getSender(ms);
                const senderPushName = getPushName(ms);

                if (!sender || sender === botJid || sender === botOwnerJid)
                    continue;

                const _jid = key.remoteJid;
                const _entry = {...ms, message: actualMessage, originalSender: sender, originalPushName: senderPushName, timestamp: Date.now() };
                setImmediate(() => saveAntiDelete(_jid, _entry));
            } catch (error) {
                logger.error("Anti-delete system error:", error);
            }
        }
    });
}

function setupAutoBio(Cyber) {
    (async () => {
        const s = await getAllSettings();
        if (s.AUTO_BIO === "true") {
            setTimeout(() => AutoBio(Cyber), 1000);
            setInterval(() => AutoBio(Cyber), 1000 * 60);
        }
    })();
}

function setupAntiCall(Cyber) {
    Cyber.ev.on("call", async (json) => {
        await Anticall(json, Cyber);
    });
}

let _newsletterCache = null;
let _newsletterCacheAt = 0;
const NEWSLETTER_TTL = 2 * 60 * 1000;

async function _getNewsletters() {
    if (_newsletterCache && Date.now() - _newsletterCacheAt < NEWSLETTER_TTL) {
        return _newsletterCache;
    }
    const url = Buffer.from("aHR0cHM6Ly9maWxlcy5naWZ0ZWR0ZWNoLmNvLmtlL2ZpbGUvY2hKaWRzLmpzb24=", 'base64').toString();
    const response = await axios.get(url, { timeout: 8000 });
    _newsletterCache = response.data;
    _newsletterCacheAt = Date.now();
    return _newsletterCache;
}

function setupNewsletterReact(Cyber) {
    const emojiList = ["❤️", "💛", "👍", "💜", "😮", "🤍", "💙"];
    Cyber.ev.on("messages.upsert", async (mek) => {
        try {
            const msg = mek.messages[0];
            if (!msg?.message ||!msg?.key?.server_id) return;
            const newsletters = await _getNewsletters();
            if (!newsletters.includes(msg.key.remoteJid)) return;
            const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
            await Cyber.newsletterReactMessage(
                msg.key.remoteJid,
                msg.key.server_id.toString(),
                emoji,
            );
        } catch (err) {
            if (err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') {
                _newsletterCache = null;
            }
        }
    });
}

function setupPresence(Cyber) {
    Cyber.ev.on("messages.upsert", async ({ messages }) => {
        if (messages?.length > 0) {
            await Presence(Cyber, messages[0].key.remoteJid);
        }
    });

    Cyber.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            Presence(Cyber, "status@broadcast");
        }
    });
}

function setupChatBotAndAntiLink(Cyber) {
    Cyber.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const firstMsg = messages[0];
        if (firstMsg?.message) {
            const s = await getAllSettings();
            if (s.CHATBOT === "true" || s.CHATBOT === "audio") {
                ChatBot(
                    Cyber,
                    s.CHATBOT,
                    s.CHATBOT_MODE || "inbox",
                    createContext,
                    createContext2,
                    googleTTS,
                );
            }
        }

        for (const message of messages) {
            if (!message?.message) continue;
            const from = message.key?.remoteJid || "";
            if (message.key.fromMe &&!from.endsWith("@g.us")) continue;

            if (from.endsWith("@g.us")) {
                await AntiLink(Cyber, message, getGroupMetadata);
                await Antibad(Cyber, message, getGroupMetadata);
            }
            await AntiGroupMention(Cyber, message, getGroupMetadata);
            await handleGameMessage(Cyber, message);
        }
    });
}

function setupAntiEdit(Cyber) {
    Cyber.ev.on("messages.update", async (updates) => {
        for (const update of updates) {
            try {
                if (!update?.update?.message) continue;
                if (update.key?.fromMe) continue;
                if (update.key?.remoteJid === "status@broadcast") continue;
                await AntiEdit(Cyber, update, findAntiDelete);
            } catch (err) {
                console.error("Anti-edit handler error:", err.message);
            }
        }
    });
}

function setupStatusHandlers(Cyber) {
    Cyber.ev.on("messages.upsert", async (mek) => {
        try {
            mek = mek.messages[0];
            if (!mek ||!mek.message) return;

            mek.message =
                getContentType(mek.message) === "ephemeralMessage"
                   ? mek.message.ephemeralMessage.message
                    : mek.message;

            if (mek.key?.remoteJid!== "status@broadcast") return;

            const s = await getAllSettings();

            const rawParticipant = mek.participant || mek.key.participantPn || mek.key.participant;
            const participantJid = await resolveRealJid(Cyber, rawParticipant);

            const shouldView = s.AUTO_READ_STATUS === "true";

            const readKey = (participantJid && participantJid!== mek.key.participant)
               ? {...mek.key, participant: participantJid }
                : mek.key;

            if (shouldView) {
                await Cyber.readMessages([readKey]);
            }

            if (shouldView && s.AUTO_LIKE_STATUS === "true" && participantJid) {
                const emojis = (s.STATUS_LIKE_EMOJIS || "💛,❤️,💜,🤍,💙").split(",").map(e => e.trim()).filter(Boolean);
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                const reactKey = {...mek.key, participant: participantJid };
                await Cyber.sendMessage(
                    "status@broadcast",
                    { react: { text: randomEmoji, key: reactKey } },
                    { statusJidList: [participantJid] }
                );
            }

            if (shouldView && s.AUTO_REPLY_STATUS === "true" &&!mek.key.fromMe && participantJid) {
                await Cyber.sendMessage(
                    participantJid,
                    { text: s.STATUS_REPLY_TEXT || DEFAULT_SETTINGS.STATUS_REPLY_TEXT },
                    { quoted: mek }
                );
            }
        } catch (error) {
            const code = error?.output?.statusCode || error?.code || "";
            const msg = error?.message || "";
            const transient =
                code === 428 ||
                msg === "Connection Closed" ||
                msg.includes("ECONNRESET") ||
                msg.includes("ETIMEDOUT") ||
                msg.includes("ECONNREFUSED") ||
                msg.includes("EPIPE") ||
                msg.includes("Connection Terminated") ||
                msg.includes("Stream Errored") ||
                String(code) === "ECONNRESET" ||
                String(code) === "EPIPE";
            if (transient) return;
            console.error("Error Processing Status Actions:", error);
        }
    });
}

const processedMessages = new Set();
const BOT_START_TIME = Date.now();

function setupCommandHandler(Cyber) {
    Cyber.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append") return;

        const ms = messages[0];
        if (!ms?.message ||!ms?.key) return;

        const messageId = ms.key.id;
        if (processedMessages.has(messageId)) return;
        processedMessages.add(messageId);

        setTimeout(() => processedMessages.delete(messageId), 60000);

        const messageTimestamp =
            (ms.messageTimestamp?.low || ms.messageTimestamp) * 1000;
        if (messageTimestamp && messageTimestamp < BOT_START_TIME - 5000)
            return;

        const settings = await getAllSettings();
        const botId = standardizeJid(Cyber.user?.id);

        const serialized = await serializeMessage(ms, Cyber, settings);
        if (!serialized) return;

        const {
            from,
            isGroup,
            body,
            isCommand,
            command,
            args,
            sender: rawSender,
            messageAuthor,
            user,
            pushName,
            quoted,
            repliedMessage,
            mentionedJid,
            tagged,
            quotedMsg,
            quotedKey,
            quotedUser,
        } = serialized;

        const groupData = await getGroupInfo(Cyber, from, botId, rawSender);
        const {
            groupInfo,
            groupName,
            participants,
            groupAdmins,
            groupSuperAdmins,
            isBotAdmin,
            isAdmin,
            isSuperAdmin,
            sender,
        } = groupData;

        const superUser = await buildSuperUsers(
            settings,
            getSudoNumbers,
            botId,
            settings.OWNER_NUMBER || "",
        );
        const isSuperUser = superUser.includes(sender);

        if (settings.AUTO_BLOCK && sender &&!isSuperUser &&!isGroup) {
            const countryCodes = settings.AUTO_BLOCK.split(",").map((code) =>
                code.trim(),
            );
            if (countryCodes.some((code) => sender.startsWith(code))) {
                try {
                    await Cyber.updateBlockStatus(sender, "block");
                } catch (blockErr) {
                    console.error("Block error:", blockErr);
                }
            }
        }

        const autoReadMode = settings.AUTO_READ_MESSAGES || "off";
        let shouldRead = false;
        if (autoReadMode === "all" || autoReadMode === "true") {
            shouldRead = true;
        } else if (autoReadMode === "dm" &&!isGroup) {
            shouldRead = true;
        } else if (autoReadMode === "groups" && isGroup) {
            shouldRead = true;
        } else if (autoReadMode === "commands" && isCommand) {
            shouldRead = true;
        }
        if (shouldRead) await Cyber.readMessages([ms.key]);

        const bodyCmd = findBodyCommand(body);
        if (bodyCmd && bodyCmd.function) {
            if (settings.MODE?.toLowerCase() === "private" &&!isSuperUser)
                return;
            try {
                const helpers = createHelpers(Cyber, ms, from);
                const conText = buildContext(ms, settings, helpers, {
                    from,
                    isGroup,
                    groupInfo,
                    groupName,
                    participants,
                    groupAdmins,
                    groupSuperAdmins,
                    isBotAdmin,
                    isAdmin,
                    isSuperAdmin,
                    sender,
                    superUser,
                    isSuperUser,
                    messageAuthor,
                    user,
                    pushName,
                    args,
                    quoted,
                    repliedMessage,
                    mentionedJid,
                    tagged,
                    quotedMsg,
                    quotedKey,
                    quotedUser,
                    Cyber,
                    botId,
                    body,
                    command,
                });
                await bodyCmd.function(from, Cyber, conText);
            } catch (error) {
                console.error(`Body command error:`, error);
            }
        }

        if (isCommand && command) {
            const gmd = findCommand(command);
            if (!gmd) return;

            if (settings.MODE?.toLowerCase() === "private" &&!isSuperUser)
                return;

            try {
                const helpers = createHelpers(Cyber, ms, from);

                if (settings.AUTO_REACT === "commands") {
                    const randomEmoji =
                        emojis[Math.floor(Math.random() * emojis.length)];
                    await Cyber.sendMessage(from, {
                        react: { key: ms.key, text: randomEmoji },
                    });
                } else if (gmd.react) {
                    await Cyber.sendMessage(from, {
                        react: { key: ms.key, text: gmd.react },
                    });
                }

                setupCyberHelpers(Cyber, from);

                const conText = buildContext(ms, settings, helpers, {
                    from,
                    isGroup,
                    groupInfo,
                    groupName,
                    participants,
                    groupAdmins,
                    groupSuperAdmins,
                    isBotAdmin,
                    isAdmin,
                    isSuperAdmin,
                    sender,
                    superUser,
                    isSuperUser,
                    messageAuthor,
                    user,
                    pushName,
                    args,
                    quoted,
                    repliedMessage,
                    mentionedJid,
                    tagged,
                    quotedMsg,
                    quotedKey,
                    quotedUser,
                    Cyber,
                    botId,
                    body,
                    command,
                });

                await gmd.function(from, Cyber, conText);
            } catch (error) {
                console.error(`Command error [${command}]:`, error);
                try {
                    await Cyber.sendMessage(
                        from,
                        {
                            text: `🚨 Command failed: ${error.message}`,
                           ...(await createContext(messageAuthor, {
                                title: "Error",
                                body: "Command execution failed",
                            })),
                        },
                        { quoted

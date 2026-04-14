const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const P = require('pino')
const fs = require('fs')
const path = require('path')
const express = require('express')
const os = require('os')

// ==================== CONFIG ====================
const SESSION_ID = process.env.SESSION_ID
const PREFIX = process.env.PREFIX || '.'
const OWNER_NUMBER = process.env.OWNER_NUMBER
const BOT_NAME = 'CYBERMASTER-MD'
const PORT = process.env.PORT || 3000

// Validate SESSION_ID
if (!SESSION_ID ||!SESSION_ID.startsWith('CYBERMASTER:~')) {
    console.log('[ERROR] SESSION_ID is invalid. Must start with CYBERMASTER:~')
    process.exit(1)
}

const sessionData = SESSION_ID.replace('CYBERMASTER:~', '')

// ==================== COMMAND SYSTEM ====================
const commands = new Map()

// Command: ping
commands.set('ping', {
    desc: 'Check bot response speed',
    category: 'general',
    run: async ({ sock, sender }) => {
        const start = Date.now()
        const msg = await sock.sendMessage(sender, { text: 'Testing speed...' })
        const latency = Date.now() - start
        await sock.sendMessage(sender, { 
            text: `🏓 *Pong!*\n\nResponse Time: ${latency}ms\nUptime: ${runtime(process.uptime())}`,
            edit: msg.key 
        })
    }
})

// Command: menu
commands.set('menu', {
    desc: 'Display all commands

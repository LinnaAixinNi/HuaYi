import fs from "fs"
import path from "path"
import chalk from "chalk"
import { fileURLToPath } from "url"

import config from "./config.js"
import plugins from "./lib/plugins.js"
import { smsg } from "./lib/serialize.js"
import { formatTime, pickRandom } from "./lib/function.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default async function handler(sock, msg) {

    let m = smsg(sock, msg)

    if (!m.message) return
    if (!global.db) return

    let user = global.db.user[m.sender]

    if (!user) {
    global.db.user[m.sender] = {
        premium: false,
        owner: false,
        banned: false,
        // Economy
        limit: 25,
        money: 0,
        // Leveling
        exp: 0,
        level: 1,
        // Access
        premium: false,
        aksesCpt: false,
        // Data
        registered: false,
        name: m.pushName || "No Name",
        // Cooldown
        lastclaim: 0,
        lastdaily: 0
    }
    }

    let chat = global.db.group[m.chat]

    if (!chat) {
        global.db.group[m.chat] = {
            welcome: false,
            antilink: false,
            antidelete: false,
            mute: false
        }
    }

    user = global.db.user[m.sender]
    chat = global.db.group[m.chat]

    const body =
        m.text ||
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        ""

    const prefixRegex = /^[!./#$%^&+=?,;:~-]/

    const prefix = prefixRegex.test(body)
        ? body.match(prefixRegex)[0]
        : config.prefix

    const isCmd = body.startsWith(prefix)

    if (!isCmd) return

    const args = body
        .slice(prefix.length)
        .trim()
        .split(/ +/)

    const command = args.shift().toLowerCase()

    console.log(
        chalk.cyan("[CMD]"),
        chalk.green(command),
        chalk.white(m.sender)
    )
}

// ====================
// FIND PLUGIN
// ====================

let plugin = null

for (const file in plugins) {
    const p = plugins[file]

    if (!p.command) continue

    const commands = Array.isArray(p.command)
        ? p.command
        : [p.command]

    const alias = Array.isArray(p.alias)
        ? p.alias
        : (p.alias ? [p.alias] : [])

    if (
        commands.includes(command) ||
        alias.includes(command)
    ) {
        plugin = p
        break
    }
}

if (!plugin) return

// ====================
// GROUP METADATA
// ====================

let groupMetadata = {}
let participants = []
let admins = []

if (m.isGroup) {
    groupMetadata = await sock.groupMetadata(m.chat)

    participants = groupMetadata.participants || []

    admins = participants
        .filter(v => v.admin !== null)
        .map(v => v.id)
}

// ====================
// PERMISSION
// ====================

const isOwner =
    config.owner.includes(m.sender)

const isAdmin =
    admins.includes(m.sender)

const isBotAdmin =
    admins.includes(sock.user.id)

const isPremium =
    user.premium || isOwner

const isEarly =
    user.aksesCpt || isOwner

// ====================
// FILTER
// ====================

if (user.banned)
    return m.reply("🚫 Kamu telah dibanned dari bot.")

if (chat.mute && !isOwner)
    return

if (plugin.owner && !isOwner)
    return m.reply("❌ Fitur khusus Owner.")

if (plugin.group && !m.isGroup)
    return m.reply("❌ Fitur hanya bisa digunakan di grup.")

if (plugin.private && m.isGroup)
    return m.reply("❌ Fitur hanya bisa digunakan di private chat.")

if (plugin.admin && !isAdmin)
    return m.reply("❌ Fitur khusus Admin Grup.")

if (plugin.botAdmin && !isBotAdmin)
    return m.reply("❌ Bot harus menjadi Admin.")

if (plugin.premium && !isPremium)
    return m.reply("💎 Fitur khusus Premium.")

if (plugin.early && !isEarly)
    return m.reply("🧪 Fitur masih Early Access.")

// ====================
// LIMIT
// ====================

plugin.limit = plugin.limit || 0

if (!isOwner && !isPremium) {

    if (user.limit < plugin.limit)
        return m.reply(
            `❌ Limit kamu habis.\n\nSisa : ${user.limit}`
        )

    user.limit -= plugin.limit
               }

// ======================
// BEFORE HOOK
// ======================

if (typeof plugin.before === "function") {
    const before = await plugin.before({
        sock,
        m,
        args,
        command,
        text: args.join(" "),
        user,
        chat,
        isOwner,
        isAdmin,
        isBotAdmin,
        isPremium,
        isEarly
    })

    if (before === false) return
}

// ======================
// COOLDOWN
// ======================

global.cooldown ??= {}

const cd = plugin.cooldown || 0

if (cd > 0 && !isOwner) {

    if (!global.cooldown[m.sender])
        global.cooldown[m.sender] = {}

    const now = Date.now()

    const expired =
        global.cooldown[m.sender][command] || 0

    if (now < expired) {

        const left = Math.ceil(
            (expired - now) / 1000
        )

        return m.reply(
            `⏳ Tunggu ${left} detik lagi.`
        )
    }

    global.cooldown[m.sender][command] =
        now + (cd * 1000)
}

// ======================
// EXECUTE
// ======================

try {

    await plugin.run({
        sock,
        m,

        args,
        text: args.join(" "),
        command,

        user,
        chat,

        isOwner,
        isAdmin,
        isBotAdmin,
        isPremium,
        isEarly,

        participants,
        admins,
        groupMetadata,

        db: global.db
    })

    user.command++

    console.log(
        chalk.green("✔"),
        chalk.yellow(command),
        chalk.white(m.pushName || m.sender)
    )

} catch (err) {

    console.log(err)

    m.reply(
`❌ Terjadi kesalahan.

${err.message}`
    )

      }

// =====================
// ALL HOOK
// =====================

for (const file in plugins) {

    const p = plugins[file]

    if (typeof p.all !== "function")
        continue

    try {

        await p.all({
            sock,
            m,
            db: global.db
        })

    } catch (e) {
        console.log(e)
    }

}


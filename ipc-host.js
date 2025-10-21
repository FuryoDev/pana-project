#!/usr/bin/env node
/**
 * ipc-host.js — Mini hôte IPC pour un module Companion lancé hors Companion.
 *
 * Prérequis:
 *  - Node 18+ (ou 16+ avec flag --experimental-modules)
 *  - Ce fichier en ESM (ajoute "type":"module" dans ton package.json si besoin)
 *
 * Usage exemple:
 *   node ipc-host.js \
 *     --module ./src/index.js \
 *     --manifest ./companion/manifest.json \
 *     --cwd "C:/Users/admin/WebstormProjects/companion-module-panasonic-cameras-main" \
 *     --auth admin:YOUR_PASSWORD \
 *     --conn-id panadev-1
 *
 * Idée:
 *  - fork() le module avec stdio 'ipc'
 *  - injecter MODULE_MANIFEST + CONNECTION_ID
 *  - journaliser/relayer les messages et fournir une config minimale
 *  - REPL: taper un JSON pour envoyer un message au module
 */

import { fork } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import readline from 'node:readline'

/* ----------------------------- CLI helpers ----------------------------- */

function arg(name, def = undefined) {
    const i = process.argv.indexOf(name)
    if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]
    return def
}

const moduleRel   = arg('--module')
const manifestRel = arg('--manifest')
const cwdRel      = arg('--cwd', process.cwd())
const basicAuth   = arg('--auth')         // "user:pass" (optionnel)
const connIdArg   = arg('--conn-id')      // identifiant d'instance (optionnel)
const enableMaps  = arg('--source-maps')  // ajoute --enable-source-maps si passé

if (!moduleRel || !manifestRel) {
    console.error('Usage: node ipc-host.js --module <path> --manifest <path> [--cwd <dir>] [--auth user:pass] [--conn-id id]')
    process.exit(1)
}

const CWD          = isAbsolute(cwdRel) ? cwdRel : resolve(process.cwd(), cwdRel)
const MODULE_ENTRY = isAbsolute(moduleRel) ? moduleRel : resolve(CWD, moduleRel)
const MANIFEST_PATH= isAbsolute(manifestRel) ? manifestRel : resolve(CWD, manifestRel)

if (!existsSync(MODULE_ENTRY)) {
    console.error('Module entry not found:', MODULE_ENTRY)
    process.exit(1)
}
if (!existsSync(MANIFEST_PATH)) {
    console.error('Manifest not found:', MANIFEST_PATH)
    process.exit(1)
}

let manifestJson = {}
try {
    manifestJson = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (e) {
    console.warn('Warn: manifest not parseable, continuing anyway:', e.message)
}

/* ----------------------- Démarrage du process enfant ------------------- */

const CONNECTION_ID = connIdArg || `devhost-${Date.now()}-${Math.random().toString(16).slice(2)}`

console.log('--- IPC HOST ---')
console.log('CWD        :', CWD)
console.log('ENTRY      :', MODULE_ENTRY)
console.log('MANIFEST   :', MANIFEST_PATH)
console.log('Manifest id:', manifestJson?.id, 'api:', manifestJson?.api)
console.log('Connection ID:', CONNECTION_ID)

const execArgv = []
if (enableMaps) execArgv.push('--enable-source-maps')

const child = fork(MODULE_ENTRY, {
    cwd: CWD,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: {
        ...process.env,
        // Essentiels pour @companion-module/base:
        MODULE_MANIFEST: MANIFEST_PATH,
        CONNECTION_ID: CONNECTION_ID,
        // Certains modules lisent aussi ceci comme identifiant d'instance:
        MODULE_INSTANCE_ID: CONNECTION_ID,
        NODE_ENV: process.env.NODE_ENV || 'development',
    },
    execArgv,
})

let ready = false

/* ----------------------------- IPC handlers ---------------------------- */
/**
 * Le protocole IPC interne de Companion n'est pas public/stable.
 * On route par "type" si présent, sinon on log. Ajoute/ajuste selon les messages observés.
 */
const handlers = {
    // Messages d'annonce génériques
    announce(msg) {
        console.log('[host] announce ->', msg?.payload ?? msg)
    },

    // Logs structurés éventuels
    log(msg) {
        const level = msg?.level || 'info'
        const text  = msg?.text || JSON.stringify(msg)
        console.log(`[module-log:${level}] ${text}`)
    },

    // Demande de config par le module (nom arbitraire ici, ajuste si besoin)
    'get-config'(msg) {
        console.log('[host] get-config -> providing minimal config')
        const config = {
            host: '192.168.0.50', // À adapter
            port: 80,
            protocol: 'http',
            ...(basicAuth
                ? { username: basicAuth.split(':')[0] || 'admin', password: basicAuth.split(':')[1] || '' }
                : {}),
        }
        send({ type: 'set-config', payload: config })
    },

    // Ping/pong (si nécessaire)
    ping() {
        send({ type: 'pong' })
    },

    // Prêt
    ready(msg) {
        ready = true
        console.log('[host] module READY:', msg?.payload ?? '')
    },

    // Catch-all
    '*': (msg) => {
        // Affiche proprement même si ce n'est pas un objet
        try {
            console.log('[ipc message]', typeof msg === 'object' ? JSON.stringify(msg) : String(msg))
        } catch {
            console.log('[ipc message]', msg)
        }
    },
}

/* ------------------------------ Utilitaires ---------------------------- */

function send(obj) {
    if (!child.connected) {
        console.error('[host] child not connected')
        return
    }
    child.send(obj)
}

/* --------------------------- Wiring des events ------------------------- */

child.on('message', (msg) => {
    try {
        const type = typeof msg === 'object' && msg?.type ? String(msg.type) : null
        if (type && handlers[type]) {
            handlers[type](msg)
        } else if (handlers['*']) {
            handlers['*'](msg)
        }
    } catch (e) {
        console.error('[host] error in handler:', e)
    }
})

child.on('exit', (code, signal) => {
    console.log(`[host] child exited code=${code} signal=${signal || ''}`)
    process.exit(code ?? 0)
})

child.on('error', (err) => {
    console.error('[host] child error:', err)
})

/* --------------------------------- REPL -------------------------------- */

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
console.log('\n[REPL] Tape un objet JSON à envoyer via IPC, ex:')
console.log('  {"type":"action","payload":{"id":"preset_recall","preset":3}}')
console.log('CTRL+C pour quitter.\n')

rl.on('line', (line) => {
    const s = line.trim()
    if (!s) return
    try {
        const obj = JSON.parse(s)
        send(obj)
    } catch (e) {
        console.error('[REPL] JSON invalide:', e.message)
    }
})

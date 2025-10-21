#!/usr/bin/env node
/**
 * run-local.js — Lance ton module Panasonic en mode autonome
 * ------------------------------------------------------------
 * Objectif : permettre de tester le code sans Companion
 * Utilisation :
 *   node run-local.js --ip 192.168.0.10 --cmd "#R01"
 *   node run-local.js --ip 192.168.0.10 --pan 50 --tilt 50
 *   node run-local.js --ip 192.168.0.10 --preset 01
 */

import http from 'http'
import { URL } from 'url'

// ------------------ Configuration / Parsing ------------------

function parseArgs() {
    const args = process.argv.slice(2)
    const out = {}
    for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '--ip') out.ip = args[++i]
        else if (a === '--cmd') out.cmd = args[++i]
        else if (a === '--pan') out.pan = args[++i]
        else if (a === '--tilt') out.tilt = args[++i]
        else if (a === '--preset') out.preset = args[++i]
        else if (a === '--help' || a === '-h') out.help = true
    }
    return out
}

function printHelp() {
    console.log(`
Panasonic AW-UE150 - Mode Local Test
------------------------------------
Usage:
  node run-local.js --ip <IP> --cmd "#R01"
  node run-local.js --ip <IP> --pan 50 --tilt 50
  node run-local.js --ip <IP> --preset 01

Options:
  --cmd <commande>   Envoie une commande brute (ex: "#PTS5050")
  --pan <val>        Définir valeur pan (00-99)
  --tilt <val>       Définir valeur tilt (00-99)
  --preset <num>     Rappeler preset (00-99)
`)
}

// ------------------ Envoi HTTP vers la caméra ------------------

async function sendToCamera(ip, command) {
    const url = new URL(`http://${ip}/cgi-bin/aw_ptz`)
    url.searchParams.set('cmd', command)
    url.searchParams.set('res', '1')

    console.log(`➡️  Envoi: ${url}`)
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () => {
                console.log(`✅ Réponse: ${res.statusCode} - ${data}`)
                resolve(data)
            })
        })
        req.on('error', (err) => {
            console.error('❌ Erreur:', err.message)
            reject(err)
        })
    })
}

// ------------------ Main ------------------

async function main() {
    const { ip, cmd, pan, tilt, preset, help } = parseArgs()
    if (help || !ip) return printHelp()

    let command = cmd

    if (!command) {
        if (pan && tilt) {
            command = `#PTS${pan}${tilt}` // pan/tilt
        } else if (preset) {
            command = `#R${preset.padStart(2, '0')}` // recall preset
        } else {
            return printHelp()
        }
    }

    await sendToCamera(ip, command)
}

main().catch((e) => console.error('💥 Erreur:', e))

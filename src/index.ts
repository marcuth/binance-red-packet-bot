import { NewMessage, NewMessageEvent } from "telegram/events"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { StoreSession } from "telegram/sessions"
import * as readlineSync from "readline-sync"
import { Browser, Page } from "puppeteer"
import { TelegramClient } from "telegram"
import puppeteer from "puppeteer-extra"
import path from "path"
import fs from "fs"

import { delay } from "./helepers/delay"
import config from "./config"

// adicionar redis para cache de códigos e registrar os códigos processados em um Sqlite

const codeQueue: string[] = []
let isProcessing = false

let invaidCodeCount = 0

const processedCodes: Set<string> = new Set()
const processedCodesFilePath = path.join(__dirname, "..", "processed_codes.txt")

function saveProcessedCode(code: string): void {
    if (!processedCodes.has(code)) {
        processedCodes.add(code)
        fs.appendFileSync(processedCodesFilePath, `${code}\n`, "utf8")
        console.log(`💾 Código "${code}" salvo como processado.`)
    }
}

async function closeModal(page: Page): Promise<void> {
    try {
        const closeButtonSelector = config.binance.selectors.modalCloseButton

        const closeButton = await page.$(closeButtonSelector)

        if (closeButton) {
            await closeButton.click()
            console.log("Modal fechado.")
            await delay(1000)
        }
    } catch (error) {
        console.warn("Não foi possível fechar o modal ou o modal não estava presente para fechar:", error)
    }
}

async function sendRedpackCode(page: Page, code: string) {
    const inputSelector = config.binance.selectors.redPacketCodeInput
            
    await page.waitForSelector(inputSelector)
    const inputField = await page.$(inputSelector)

    if (!inputField) {
        throw new Error("O input de código de redpack não foi encontrado!")
    }
    
    await inputField.click({ clickCount: 3 })
    await page.keyboard.press("Backspace")

    const inputCurrentValue = await page.evaluate((selector) => {
        const input = document.querySelector(selector) as HTMLInputElement
        return input.value
    }, inputSelector)

    if (inputCurrentValue !== "") {
        throw new Error("O input não está vazio!")
    }

    await inputField.type(code)

    console.log(`Código "${code}" digitado.`)
}

async function clickOnRedeemButton(page: Page) {
    const redeemButtonSelector = config.binance.selectors.redeemButton
    const redeemButton = await page.waitForSelector(redeemButtonSelector)
    
    if (redeemButton) {
        console.log("Botão 'Resgate' clicado.")
        await redeemButton.click()
    } else {
        console.log("Botão de 'Resgate' não foi encontrado!")
    }

    await delay(1000)
}

async function checkIsInvalidCode(code: string, page: Page) {
    const invalidErrorElement = await page.$(config.binance.selectors.invalidCodeError)

    if (invalidErrorElement) {
        const errorText = await page.evaluate(el => el.textContent, invalidErrorElement)

        if (errorText && errorText.includes(config.binance.indicators.invalidCodeText)) {
            return true
        }
    }

    false
}

async function openRedPaket(page: Page) {
    const openButtonSelector = config.binance.selectors.openButton
    const openButton = await page.waitForSelector(openButtonSelector)

    if (openButton) {
        await openButton.click()
    }

    await delay(1000)
}

function redeemRedpackCode(page: Page) {
    return async (code: string): Promise<boolean> => {
        try {
            console.log(`Tentando resgatar o código: ${code}`)
            
            await sendRedpackCode(page, code)
            await clickOnRedeemButton(page)

            let pageContent = await page.content()

            const isInvalidCode = await checkIsInvalidCode(code, page)
            
            if (isInvalidCode) {
                console.warn(`❌ Código ${code} inválido`)
                invaidCodeCount += 1

                if (invaidCodeCount > 5) {
                    console.log("Encerrando o bot por conta de vários códigos inválidos inseridos!")
                    process.exit(0)
                }

                return isInvalidCode
            }

            if (pageContent.includes(config.binance.indicators.fullyRedeemedPage)) {
                console.warn(`❌ Red Packet ${code} já foi totalmente resgatado na página.`)
                await closeModal(page)
                return false
            }

            if (pageContent.includes(config.binance.indicators.successFinal)) {
                console.log(`✅ Código ${code} resgatado com sucesso! Criptomoedas enviadas para a sua Conta de Fundos.`)

                await openRedPaket(page)
                pageContent = await page.content()

                await closeModal(page)
            }

            if (pageContent.includes(config.binance.indicators.fullyRedeemedPage)) {
                console.warn(`❌ Red Packet ${code} já foi totalmente resgatado na página.`)
                await closeModal(page)
                return false
            }

            if (pageContent.includes(config.binance.indicators.successFinal)) {
                console.log(`✅ Código ${code} resgatado com sucesso! Criptomoedas enviadas para a sua Conta de Fundos.`)
                await closeModal(page)
                return true
            }

            if (pageContent.toLowerCase().includes(config.binance.indicators.expiredModal.toLowerCase())) {
                console.warn(`❌ Red Packet ${code} expirado (detectado no modal/página).`)
                await closeModal(page)
                return false
            }
            
            console.log(`🔍 Não foi possível determinar o resultado do resgate para o código ${code}. Último conteúdo da página para depuração:\n${pageContent.substring(0, 500)}...`)
            
            await closeModal(page)

            return false

        } catch (error) {
            console.error(`Erro inesperado ao tentar resgatar o código ${code}:`, error)
            await closeModal(page)
            return false
        }
    }
}

async function processCodeQueue(redeemHandler: (code: string) => Promise<boolean>) {
    // Se já estiver processando ou a fila estiver vazia, não faz nada
    if (isProcessing || codeQueue.length === 0) {
        return
    }

    isProcessing = true // Define a flag como true para indicar que o processamento começou
    const codeToRedeem = codeQueue.shift() // Pega o primeiro código da fila

    if (codeToRedeem) {
        if (processedCodes.has(codeToRedeem)) {
            console.log(`O código ${codeToRedeem} já foi processado antes`)
        } else {
            console.log(`\nIniciando o resgate do código da fila: ${codeToRedeem}`)

            saveProcessedCode(codeToRedeem)

            const success = await redeemHandler(codeToRedeem)

            if (success) {
                console.log(`🎉 Sucesso no resgate do código da fila: ${codeToRedeem}`)
            } else {
                console.warn(`⚠️ Não foi possível resgatar o código da fila: ${codeToRedeem}`)
            }
        }
    }

    isProcessing = false // Libera a flag após o processamento

    // Se ainda houver códigos na fila, chama a função novamente para processar o próximo
    if (codeQueue.length > 0) {
        console.log(`Há ${codeQueue.length} códigos restantes na fila. Processando o próximo...`)
        await processCodeQueue(redeemHandler)
    } else {
        console.log("Fila de códigos vazia. Aguardando novos códigos.")
    }
}

async function initializeTelegramClient(
    onRedpackCode: (code: string) => Promise<boolean>
) {
    const fileSession = new StoreSession(config.telegram.sessionPath)

    const client = new TelegramClient(
        fileSession,
        config.telegram.apiId,
        config.telegram.apiHash,
        {
            connectionRetries: config.telegram.connectRetries,
        }
    )

    try {
        await client.start({
            phoneNumber: config.telegram.phone,
            password: async () => readlineSync.question("Por favor, insira sua senha de duas etapas (2FA): ", { hideEchoBack: true }),
            phoneCode: async () => readlineSync.question("Por favor, insira o código de verificação enviado ao seu Telegram: "),
            onError: (error) => console.error("Erro do cliente Telegram:", error),
        })

        console.log(`Conectado como: ${(await client.getMe()).firstName}`)

        console.log(`Sessão salva automaticamente em: ${config.telegram.sessionPath}`)

        client.addEventHandler(async (event: NewMessageEvent) => {
            if (event.message && String(event.chatId) === config.telegram.channelId && event.message.message) {
                const messageText = event.message.message
                console.log(`\nNova mensagem no canal '${config.telegram.channelId}': ${messageText}`)

                const redPacketCodeRegex = /[A-Z0-9]{8}/g
                let match = redPacketCodeRegex.exec(messageText)

                if (match) {
                    const code = match[0]
                    console.log(`💰 Código de Red Packet encontrado: ${code}`)

                    codeQueue.push(code)
                    console.log(`Código ${code} adicionado à fila. Tamanho da fila: ${codeQueue.length}`)
                    await processCodeQueue(onRedpackCode)
                } else {
                    console.log(`Nenhum código encontrado na mensagem '${messageText}'`)
                }
            }
        }, new NewMessage({ chats: [parseInt(config.telegram.channelId)] }))

        console.log(`\nEscutando novas mensagens no canal: '${config.telegram.channelId}'...`)
        console.log("Pressione Ctrl+C para parar o cliente.")

    } catch (error) {
        console.error("Falha ao iniciar o cliente Telegram:", error)
        process.exit(1)
    }
}

async function loadCookies(browser: Browser): Promise<boolean> {
    const cookiesFilePath = path.join(__dirname, "..", "cookies", "www.binance.com.cookies.json")

    if (fs.existsSync(cookiesFilePath)) {
        try {
            const cookiesString = fs.readFileSync(cookiesFilePath, "utf8")
            const cookies = JSON.parse(cookiesString)
            await browser.setCookie(...cookies)
            console.log("Cookies da Binance carregados.")
            return true
        } catch (error) {
            console.error("Erro ao carregar ou analisar cookies:", error)
            return false
        }
    }

    console.log("Arquivo de cookies não encontrado. Será necessário fazer login.")

    return false
}

async function main() {
    puppeteer.use(StealthPlugin())

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--start-maximized"
        ],
        dumpio: true,
        // userDataDir: "./user-data"
    })

    const page = await browser.newPage()

    const session = await page.target().createCDPSession()
    await session.send("Page.enable")
    await session.send("Page.setWebLifecycleState", { state: "active" })

    let sessionActive = false

    await page.goto(config.binance.dashboardUrl, { waitUntil: "networkidle2" })

    const cookiesLoaded = await loadCookies(browser)

    if (cookiesLoaded) {
        console.log("Tentando navegar para o dashboard da Binance com cookies existentes...")
        await page.goto(config.binance.dashboardUrl, { waitUntil: "networkidle2" })

        if (page.url().includes("/login")) {
            console.log("Sessão expirada. Redirecionado para a página de login ou formulário de login visível.")
            sessionActive = false
        } else {
            sessionActive = true
        }
    } else {
        console.log("Nenhum cookie encontrado. Sessão não ativa. Encerrando o script.")
        sessionActive = false
    }

    if (!sessionActive) {
        console.error("O script será encerrado porque a sessão da Binance não está ativa e o login automático não está configurado.")
        await browser.close()
        process.exit(1)
    }

    await page.goto(config.binance.cryptoboxPageUrl)
    const redeemRedpackCodeHandler = redeemRedpackCode(page)

    await initializeTelegramClient(redeemRedpackCodeHandler)

    setInterval(async () => await page.reload({ waitUntil: "networkidle2" }), 60 * 60 * 1000)
}

if (require.main === module) {
    main()
}
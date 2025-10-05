import env from "./helepers/env"

const config = {
    telegram: {
        channelId: env("TELEGRAM_CHANNEL_ID"),
        apiHash: env("TELEGRAM_API_HASH"),
        apiId: +env("TELEGRAM_API_ID"),
        phone: env("TELEGRAM_PHONE"),
        connectRetries: 5,
        sessionPath: "./telegram_session.json"
    },
    binance: {
        dashboardUrl: "https://www.binance.com/pt-BR/my/dashboard",
        cryptoboxPageUrl: "https://www.binance.com/pt-BR/my/wallet/account/payment/cryptobox",
        selectors: {
            redPacketCodeInput: "input[id^='bn-formItem-']", // Seletor CSS para o campo de input do código (ajustado para ID dinâmico)
            invalidCodeError: ".bn-formItem-errMsg", // Seletor para a mensagem de erro de código inválido
            modalCloseButton: "svg[fill='PrimaryText']", // Seletor para o botão de fechar modal (universal para Binance modals)
            redeemButton: "xpath///button[contains(@class, 'mt-xl') and contains(normalize-space(), 'Resgate')]",
            openButton: "xpath///button[contains(@class, 'bn-button') and contains(normalize-space(), 'Aberto')]",
        },
        indicators: {
            successFinal: "Criptomoedas enviadas para a sua Conta de Fundos", // Texto final de sucesso após resgate/abertura
            invalidCodeText: "Invalid code", // Texto para código inválido
            fullyRedeemedPage: "Este Red Packet já foi totalmente resgatado", // Texto para Red Packet totalmente resgatado (na página principal)
            expiredModal: "expirado", // Texto (case-insensitive) para Red Packet expirado (geralmente em modal)
        }
    }
}

export default config
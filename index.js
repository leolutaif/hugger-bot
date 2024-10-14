const { Connection, PublicKey } = require('@solana/web3.js');
const { pumpFunSell } = require('./swap');
const axios = require('axios');

const rpcUrl = 'https://tiniest-palpable-diagram.solana-mainnet.quiknode.pro/68883c3e540d71733aa721ebba9f729ab90652fa';
const connection = new Connection(rpcUrl, 'confirmed');
const walletAddress = new PublicKey('Ew6DauPZpniJ8rVmXteBJiA8NMeX52x1qvYcsPCFHNnj');

const processedTransactions = new Set();
let tokensInProcess = new Set(); // Rastreamento de tokens em processo de venda

// Função para obter o preço da Solana em dólares
async function getSolPriceInUSD() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        return response.data.solana.usd;
    } catch (error) {
        console.error('Erro ao obter o preço da Solana:', error);
        return null;
    }
}

// Função de venda de tokens
async function sellToken(token, retryCount = 0) {
    const maxRetries = 5;

    if (retryCount > maxRetries) {
        console.error(`Máximo de tentativas atingido para o token: ${token}`);
        return;
    }

    const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
    const slippageDecimal = parseFloat(process.env.SLIPPAGE_DECIMAL);
    const priorityFeeInSol = parseFloat(process.env.PRIORITY_FEE_IN_SOL);

    const balanceBefore = await connection.getBalance(walletAddress);
    const solPriceInUSD = await getSolPriceInUSD();

    try {
        await pumpFunSell(payerPrivateKey, token, 100, priorityFeeInSol, slippageDecimal);
        tokensInProcess.delete(token); // Remove o token da lista de processamento

        const balanceAfter = await connection.getBalance(walletAddress);
        const solSold = (balanceAfter - balanceBefore) / (10 ** 9);

        if (solPriceInUSD) {
            console.log(`Valor vendido: $${(solSold * solPriceInUSD).toFixed(2)} (${solSold} SOL)`);
        }
    } catch (error) {
        console.error(`Erro ao vender o token ${token}:`, error);
        setTimeout(() => sellToken(token, retryCount + 1), 500); // Tenta novamente após um tempo
    }
}

// Função para monitorar transações da carteira
async function getTokenPurchased(transactionSignature) {
    try {
        const transaction = await connection.getTransaction(transactionSignature, { maxSupportedTransactionVersion: 0 });

        if (transaction && transaction.meta && Array.isArray(transaction.meta.postTokenBalances)) {
            const tokensPurchased = new Set(transaction.meta.postTokenBalances.map((balance) => balance.mint));

            if (tokensPurchased.size > 0) {
                console.log('Tokens comprados:', Array.from(tokensPurchased));

                tokensPurchased.forEach(tokenMint => {
                    if (!tokensInProcess.has(tokenMint)) {
                        tokensInProcess.add(tokenMint); // Adiciona o token à lista de processamento
                        console.log(`Iniciando a venda do token ${tokenMint} imediatamente.`);
                        sellToken(tokenMint); // Inicia a venda do token imediatamente
                    }
                });
            } else {
                console.log('Nenhum token encontrado nesta transação.');
            }
        }
    } catch (error) {
        console.error('Erro ao processar a transação:', error);
    }
}

// Função para monitorar as transações da wallet e processar tokens comprados
async function monitorTransactions() {
    console.log(`Monitorando transações para a wallet: ${walletAddress.toBase58()}`);

    connection.onLogs(walletAddress, async (log) => {
        const transactionSignature = log.signature;

        if (processedTransactions.has(transactionSignature)) {
            console.log(`Transação ${transactionSignature} já foi processada. Ignorando...`);
            return;
        }

        processedTransactions.add(transactionSignature); // Marca a transação como processada
        console.log(`Nova transação detectada: ${transactionSignature}`);
        getTokenPurchased(transactionSignature).catch(err => console.error('Erro no processamento da transação:', err));
    }, 'confirmed');
}

// Inicia a monitorar as transações
monitorTransactions();

function cleanupOnExit() {
    console.log('Processo encerrado. Limpando...');
}

process.on('exit', cleanupOnExit);
process.on('SIGINT', () => process.exit());

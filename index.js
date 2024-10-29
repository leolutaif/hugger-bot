require('dotenv').config(); // Carrega as variáveis de ambiente primeiro

// Verifique se todas as variáveis de ambiente necessárias estão definidas
const requiredEnvVars = ['RPC', 'PAYER_PRIVATE_KEY', 'SLIPPAGE_DECIMAL', 'PRIORITY_FEE_IN_SOL', 'WALLET_ADDRESS'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error(`Erro: As seguintes variáveis de ambiente estão faltando: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const { pumpFunSell, executeNormalSwap } = require('./swap');
const axios = require('axios');
const fetch = require('node-fetch');
const {
    Keypair,
    SystemProgram,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL,
    Transaction,
    TransactionInstruction
} = require('@solana/web3.js');
const {
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID
} = require('@solana/spl-token');
const bs58 = require('bs58');

// Logs para depuração
console.log('Wallet Address from .env:', process.env.WALLET_ADDRESS);
console.log('RPC URL:', process.env.RPC);
console.log('PAYER_PRIVATE_KEY:', process.env.PAYER_PRIVATE_KEY ? 'Loaded' : 'Not Loaded');
console.log('SLIPPAGE_DECIMAL:', process.env.SLIPPAGE_DECIMAL);
console.log('PRIORITY_FEE_IN_SOL:', process.env.PRIORITY_FEE_IN_SOL);

// Tente criar um PublicKey de teste
let walletAddress;
try {
    walletAddress = new PublicKey(process.env.WALLET_ADDRESS);
    console.log('PublicKey criado com sucesso:', walletAddress.toBase58());
} catch (error) {
    console.error('Erro ao criar PublicKey:', error);
    process.exit(1); // Encerra o script se o PublicKey for inválido
}

const rpcUrl = process.env.RPC; // Utilize o RPC definido no arquivo .env
const connection = new Connection(rpcUrl, 'confirmed');

const processedTransactions = new Set();
let tokensInProcess = new Set(); // Rastreamento de tokens em processo de venda

// Função de venda de tokens via Jito
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

    try {
        await pumpFunSell(payerPrivateKey, token, 100, priorityFeeInSol, slippageDecimal);
        tokensInProcess.delete(token); // Remove o token da lista de processamento

        const balanceAfter = await connection.getBalance(walletAddress);
        const solSold = (balanceAfter - balanceBefore) / (10 ** 9);

        console.log(`Venda via Jito do token ${token} realizada com sucesso: ${solSold} SOL`);
    } catch (error) {
        console.error(`Erro ao vender o token ${token} via Jito:`, error);
        setTimeout(() => sellToken(token, retryCount + 1), 500); // Tenta novamente após um tempo
    }
}

// Função para monitorar transações da carteira e processar tokens comprados
async function getTokenPurchased(transactionSignature) {
    try {
        const transaction = await connection.getTransaction(transactionSignature, { maxSupportedTransactionVersion: 0 });

        if (transaction && transaction.meta && Array.isArray(transaction.meta.postTokenBalances)) {
            const tokensPurchased = new Set(transaction.meta.postTokenBalances.map((balance) => balance.mint));

            if (tokensPurchased.size > 0) {
                console.log('Tokens comprados:', Array.from(tokensPurchased));

                tokensPurchased.forEach(async (tokenMint) => {
                    if (!tokensInProcess.has(tokenMint)) {
                        tokensInProcess.add(tokenMint); // Adiciona o token à lista de processamento
                        console.log(`Iniciando a venda do token ${tokenMint} com atraso de 0,4 segundos.`);

                        // Adiciona o atraso de 0,4 segundos antes de iniciar as vendas
                        setTimeout(async () => {
                            console.log(`Enviando transação via Jito para o token ${tokenMint}`);
                            await sellToken(tokenMint); // Venda via Jito

                            // Obtenha o endereço da conta associada para o token comprado
                            const tokenAccountAddress = await getAssociatedTokenAddress(new PublicKey(tokenMint), walletAddress);

                            // Verifique o saldo após a venda via Jito para garantir que ainda há tokens disponíveis
                            const tokenAccountInfo = await connection.getParsedAccountInfo(tokenAccountAddress);
                            const tokenAmount = tokenAccountInfo?.value?.data?.parsed?.info?.tokenAmount?.amount ?? 0;

                            if (tokenAmount > 0) {
                                console.log(`Enviando transação normal para o token ${tokenMint}`);
                                await executeNormalSwap(process.env.PAYER_PRIVATE_KEY, tokenMint, 100, parseFloat(process.env.SLIPPAGE_DECIMAL)); // Venda normal
                            } else {
                                console.log('Nenhum token disponível para venda após a transação via Jito.');
                            }
                        }, 400); // 400ms de atraso
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

// Exportação corrigida
module.exports = { pumpFunSell, executeNormalSwap };

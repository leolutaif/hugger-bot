const { pumpFunSell } = require('./swap'); // Assuming these are custom utilities you’ve implemented.

async function main() {
  const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
  const slippageDecimal = parseFloat(process.env.SLIPPAGE_DECIMAL);
  const priorityFeeInSol = parseFloat(process.env.PRIORITY_FEE_IN_SOL);
  const mintStr = '2SXe48jUZwhAW7G2nJPmgkx4E9z1Tkpf7vzb4Zvkpump';
  const percentageToSell = 100; // For example, sell 50% of your tokens


  await pumpFunSell(payerPrivateKey, mintStr, percentageToSell, priorityFeeInSol, slippageDecimal);
}

main().catch((error) => {
  console.error('Error running main function:', error);
});

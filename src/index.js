require('dotenv').config(); // Load environment variables from .env file
const actualHttpApi = require('@ky1vistar/actual-http-api-client');
const monoApi = require('./api')();
const { parse, toSeconds } = require('iso8601-duration');
const currencyCodes = require('currency-codes');

// Environment variables
const ACTUAL_API_URL = process.env.ACTUAL_API_URL;
const ACTUAL_API_KEY = process.env.ACTUAL_API_KEY;
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID;
const MONO_TOKEN = process.env.MONO_TOKEN;
const ACCOUNT_IDS = !process.env.ACCOUNT_IDS ? new Map() : new Map(
  process.env.ACCOUNT_IDS.split(',').map(pair => pair.split(':'))
);
const LOOKBACK_PERIOD = toSeconds(parse(process.env.LOOKBACK_PERIOD || 'P6M')); // ISO8601 duration, default 6 months

// Constants
const STARTING_BALANCES_CATEGORY_ID = '506e8d9d-7ed0-4397-84e4-07a9185dc6b2';

// Initialize Actual API client
const actualApiConfig = new actualHttpApi.Configuration({
  basePath: ACTUAL_API_URL,
  apiKey: ACTUAL_API_KEY,
});
const actualApiClient = {
  accounts: actualHttpApi.AccountsApiFactory(actualApiConfig),
  transactions: actualHttpApi.TransactionsApiFactory(actualApiConfig),
  categories: actualHttpApi.CategoriesApiFactory(actualApiConfig),
};

async function main() {
  try {
    await monoApi.init(MONO_TOKEN);
    
    // Get client info from Monobank
    console.log('\nFetching client info from Monobank...');
    const clientInfo = await monoApi.getClientInfo();
    
    console.log(`Found ${clientInfo.accounts.length} accounts:`);
    
    clientInfo.accounts.forEach((account, index) => {
      console.log(`\nAccount #${index + 1}: ${account.type} (${account.maskedPan[0] ?? account.iban})`);
      console.log(`  ID: ${account.id}`);
      console.log(`  Currency: ${currencyCodes.number(account.currencyCode).code}`);
    });

    // Import transactions for mapped accounts
    if (ACCOUNT_IDS.size === 0) {
      console.log('\nNo account mappings defined. Please set the ACCOUNT_IDS environment variable.');
      console.log('Format: ACCOUNT_IDS=monoId1:actualId1,monoId2:actualId2');
      return;
    }

    console.log('\nAccount mappings:', Array.from(ACCOUNT_IDS.entries()));
    
    // Process each account mapping
    for (const [monoAccountId, actualAccountId] of ACCOUNT_IDS.entries()) {
      console.log(`\nProcessing account mapping: ${monoAccountId} -> ${actualAccountId}`);
      
      // Find the account in client info
      const monoAccount = clientInfo.accounts.find(account => account.id === monoAccountId);
      if (!monoAccount) {
        console.warn(`Monobank account ${monoAccountId} not found. Skipping.`);
        continue;
      }

      await importTransactionsToActual(monoAccountId, actualAccountId);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function importTransactionsToActual(monoAccountId, actualAccountId) {
  console.log(`Importing transactions for Monobank account ${monoAccountId} to Actual account ${actualAccountId}...`);

  try {
    // Get the last imported transaction
    const lastTransactions = await actualApiClient.transactions
      .budgetsBudgetSyncIdAccountsAccountIdTransactionsGet(ACTUAL_SYNC_ID, actualAccountId, "1970-01-01")
      .then(res => res.data)
      .then(data => {
        data.data = data.data.filter(tx => tx.imported_id && tx.imported_id.startsWith('mono|'));
        data.data.sort((a, b) => new Date(b.date) - new Date(a.date));
        return data;
      });

    let lastImportedId = null;
    let lastImportedDate = null;
    
    if (lastTransactions.data.length > 0) {
      lastImportedId = lastTransactions.data[0].imported_id;
      lastImportedDate = lastTransactions.data[0].date;
      console.log(`Last imported transaction: ${lastImportedDate}, ID: ${lastImportedId}`);
    }

    // Calculate lookback period
    const lookbackDate = new Date(Date.now() - LOOKBACK_PERIOD * 1000);
    lookbackDate.setUTCHours(0, 0, 0, 0); // Normalize to start of day
    console.log(`Lookback period: from ${lookbackDate.toISOString().split('T')[0]}`);

    // If we have a last imported transaction, check if it's within the lookback period
    let fromDate = lookbackDate;
    if (lastImportedDate && Date.parse(lastImportedDate) < lookbackDate) {
      fromDate = Date.parse(lastImportedDate);
      console.log(`Using last imported transaction date: ${lastImportedDate}`);
    }

    // Import transactions in batches of 31 days (Monobank limit)
    let currentEndDate = new Date();
    currentEndDate.setUTCHours(23,59,59,999);
    let allNewTransactions = [];
    let foundLastImported = false;
    let oldestTransaction = null;
    
    while (currentEndDate > fromDate) {
      const startDate = new Date(currentEndDate);
      startDate.setDate(startDate.getDate() - 31); // 31 days back
      
      // Don't go earlier than the fromDate
      const effectiveStartDate = startDate > fromDate ? startDate : fromDate;
      
      const fromTimestamp = Math.floor(effectiveStartDate.getTime() / 1000);
      const toTimestamp = Math.floor(currentEndDate.getTime() / 1000);
      
      console.log(`Fetching transactions from ${new Date(fromTimestamp * 1000).toISOString()} to ${new Date(toTimestamp * 1000).toISOString()}`);
      
      const transactions = await monoApi.getStatements(monoAccountId, fromTimestamp, toTimestamp);
      
      console.log(`Retrieved ${transactions.length} transactions`);
      
      // Process transactions
      const newTransactions = [];
      
      for (const tx of transactions) {
        oldestTransaction = tx;
        const importedId = `mono|${tx.id}`;
        
        // Skip if this is the last imported transaction or later
        if (importedId === lastImportedId) {
          console.log(`Found last imported transaction, stopping import`);
          foundLastImported = true;
          break;
        }
        
        newTransactions.push({
          account: actualAccountId,
          amount: tx.amount,
          date: new Date(tx.time * 1000).toISOString().split('T')[0],
          payee_name: tx.description,
          notes: tx.comment || `MCC: ${tx.mcc}`,
          imported_id: importedId
        });
      }
      
      allNewTransactions = allNewTransactions.concat(newTransactions);
      
      if (foundLastImported) {
        break;
      }
      
      // Move to the next period
      currentEndDate = new Date(effectiveStartDate);
    }

    if (oldestTransaction && !foundLastImported) {
      console.log('No last imported transaction found, adding starting balance');
      const categories = await actualApiClient.categories.budgetsBudgetSyncIdCategoriesGet(ACTUAL_SYNC_ID).then(res => res.data.data);
      const startingBalanceCatId = categories
        .find(cat => cat.name === 'Starting Balances')?.id || STARTING_BALANCES_CATEGORY_ID;
      allNewTransactions.push({
        account: actualAccountId,
        amount: oldestTransaction.balance - oldestTransaction.amount,
        date: new Date(oldestTransaction.time * 1000).toISOString().split('T')[0],
        payee_name: "Starting Balance",
        category: startingBalanceCatId,
        // imported_id: "mono|starting_balance",
      });
    }
    
    // Import transactions to Actual
    if (allNewTransactions.length > 0) {
      console.log(`Importing ${allNewTransactions.length} transactions to Actual Budget`);
      if (allNewTransactions.length === 0) return;
      await actualApiClient.transactions.budgetsBudgetSyncIdAccountsAccountIdTransactionsImportPost(
        ACTUAL_SYNC_ID,
        actualAccountId,
        { transactions: allNewTransactions },
      );
    } else {
      console.log('No new transactions to import');
    }
  } catch (error) {
    console.error(`Error importing transactions for account ${actualAccountId}:`, error.message);
    throw error;
  }
}

main();

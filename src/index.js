import NetSuiteService from './services/netSuite.service.js';

export {
  NetSuiteService,
};

const accountId = '6132245';
const client = '34fff4461df08479f12b492c235c6f7a29489db705e4b0fe67012943b0111471';
const secret = '44d0bc2e0707fd65e21ac2d5b7d37a44824faa65cad7735a6f45d4094571f31a';
const nsService = new NetSuiteService({ accountId, client, secret, script: 1054, deploy: 2, logToken: 'true', debug: true });
await nsService.signIn();
//const invoices = await nsService.requestGet('/record/v1/invoice');
//console.log(invoices);
//const files = await nsService.executeSuiteQl(`SELECT * FROM  MediaItemFolder WHERE id = '1253'`);
//console.info(files);
await nsService.downloadFile(524171, './');

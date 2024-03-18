# netsuite
NetSuite module to helps to manage the requests and download files from File Cabinet

## Installing
Install globally:

    npm install -g @maykoncapellari/netsuite


## Using

Import in NodeJS script:

    import { NetSuiteService } from '@maykoncapellari/netsuite';

    const nsService = new NetSuiteService({ ...params });
    await nsService.signIn();
    const invoices = await nsService.requestGet('/record/v1/invoice');
    console.log(invoices);
    const files = await nsService.executeSuiteQl(`SELECT * FROM MediaItemFolder WHERE id = '1253'`);
    console.info(files);
    await nsService.logout();
import fs from 'fs/promises';
import { BaseError, prompt } from '@maykoncapellari/cli-builder';
import { randomUUID } from 'crypto';

/**
 * NetSuite Service
 * 
 * This class allow connect to netsuite, make the requests and download files from File Cabinet
 * 
 * @class
 * @example
 * const nsService = new NetSuiteService({ ...params });
 * await nsService.signIn();
 * // Will read '~/attachmentsDir/myfile.pdf' and put on 'me/drive/root/My Sharepoint Docs/myfile.pdf' on sharepoint
 * await nsService.uploadFile('~/attachmentsDir', 'My Sharepoint Docs', 'myfile.pdf');
 * const profile = await nsService.requestGet('me'); // Get my profile data
 * await nsService.logout();
 */
export default class NetSuiteService {
  static #nsRedirectUri = 'https://login.live.com/oauth20_desktop.srf';
  static #nsAuthUrl = 'https://%s.app.netsuite.com/app/login/oauth2/authorize.nl';
  static #nsApiUrl = 'https://%s.suitetalk.api.netsuite.com/services/rest';
  static #nsScopes = 'rest_webservices';
  static #MAX_RETRIES = 3;

  #nsAccountId;
  #nsClientId;
  #nsClientSecret;
  #nsState;
  #nsCode;
  #nsAccessToken;
  #nsRefreshToken;
  #isDebug;
  #shouldLogToken;

  /**
   * The Params NetSuiteService.
   * 
   * @typedef {Object} NetSuiteServiceParams
   * @property {string} accountId - The NetSuite Account ID.
   * @property {string} client - The NetSuite APP ClientID.
   * @property {string} secret - The NetSuite APP ClientSecret.
   * @property {string} [token] - The NetSuite Access Token (When defined the client and secret is ignored)
   * @property {boolean} [debug] - Define debug mode (Default: false)
   * @property {boolean} [logToken] - Define if will log the access token after sigIn (Default: false)
   */

  /**
   * 
   * @constructor
   * @param {NetSuiteServiceParams} params
   */
  constructor({ accountId, client, secret, token, debug, logToken }) {
    if (!accountId) {
      throw new BaseError('⚠️ The NetSuite Account ID is required!');
    }
    if (!client) {
      throw new BaseError('⚠️ The NetSuite APP ClientID is required!');
    }
    if (!secret) {
      throw new BaseError('⚠️ The NetSuite APP ClientSecret is required!');
    }

    this.#nsAccountId = accountId;
    this.#nsClientId = client;
    this.#nsClientSecret = secret;
    this.logout();
    this.#nsAccessToken = token;
    this.#isDebug = debug || process.env.MS_GRAPH_DEBUG === 'true';
    this.#shouldLogToken = logToken === 'true';
  }

  #generateAuthorizeRequest() {
    this.#nsState = randomUUID();
    const nsServer = NetSuiteService.#nsAuthUrl.replace(/%s/, this.#nsAccountId);
    return `${nsServer}?client_id=${this.#nsClientId}&response_type=code&redirect_uri=${NetSuiteService.#nsRedirectUri}&scope=${NetSuiteService.#nsScopes}&state=${this.#nsState}`;
  }

  #debug(path, message) {
    if (this.#isDebug) {
      console.debug(`\n⚠️  ${path}`);
      console.debug(message);
      console.debug();
    }
  }

  #debugResponse(path, response) {
    const { url, status, statusText, body } = response;
    return this.#debug(path, { url, status, statusText, body });
  }

  #getTokenUrl() {
    return this.#getApiUrl().concat('/auth/oauth2/v1/token');
  }

  #getClientAuth() {
    return Buffer.from(`${this.#nsClientId}:${this.#nsClientSecret}`).toString('base64');
  }

  async #requestAuthorizationToken(token, grant_type = 'authorization_code') {
    const tokenKey = grant_type === 'refresh_token' ? grant_type : 'code';
    try {
      const data = new FormData();
      data.append('grant_type', grant_type);
      if (grant_type === 'authorization_code') {
        data.append('redirect_uri', NetSuiteService.#nsRedirectUri);
      }
      data.append(tokenKey, token);
      const body = new URLSearchParams(data);

      const authorization = await fetch(this.#getTokenUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${this.#getClientAuth()}`,
          },
          body,
        }).then(async (r) => {
          this.#debugResponse('RequestAuthorizationToken', r);
          return r.json();
        });
      this.#debug('RequestAuthorizationToken', authorization);
      if (authorization.error) {
        throw new BaseError(authorization.error?.message || 'Error in get authorization token');
      }
      this.#setAuthorizationTokens(authorization);
      return authorization;
    } catch (error) {
      this.#debug('RequestAuthorizationToken', error);
      throw new BaseError(`Cannot get the NetSuite authorization ${tokenKey}`);
    }    
  }

  #setAuthorizationTokens(authorization) {
    this.#nsAccessToken = authorization.access_token;
    this.#nsRefreshToken = authorization.refresh_token;
    if(this.#shouldLogToken) {
      console.info('🔑 NetSuite Access Token: %s\n', this.#nsAccessToken);
    }
  }

  async #getMyInfo() {
    return this.requestGet('/');
  }

  #getResponseLog(response) {
    const { url, status, statusText } = response;
    return { url, status, statusText };
  }

  async #refreshToken() {
    try {
      this.#debug('RefreshToken', this.#nsRefreshToken);
      return this.#requestAuthorizationToken(this.#nsRefreshToken, 'refresh_token');
    } catch (error) {
      this.#debug('RefreshToken', error);
      throw new BaseError('Cannot renew the current token, please try login again!');
    }
  }

  async #internalRequest(url, method, body, headers) {
    return fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.#nsAccessToken}`,
        ...headers,
      },
      body,
    });
  }

  async #renewTokenWithNeeded(url, method, body, headers) {
    try {
      let response = await this.#internalRequest(url, method, body, headers);
      if (response.status === 401) {
        await this.#refreshToken();
        response = await this.#internalRequest(url, method, body, headers);
      }
      this.#debug('RenewTokenWithNeeded', this.#getResponseLog(response));
      if (response.status === 401) {
        throw new BaseError(response.statusText);
      }
      return response.json();
    } catch (error) {
      this.#debug('RenewTokenWithNeeded Error', error);
      throw error;
    }
  }

  #getApiUrl() {
    return NetSuiteService.#nsApiUrl.replace(/%s/, this.#nsAccountId);
  }

  async #requestApi(url, method, body, headers = {}) {
    let retry = 1;
    let response = null;
    while(retry <= NetSuiteService.#MAX_RETRIES) {
      try {
        response = await this.#renewTokenWithNeeded(`${this.#getApiUrl()}${url}`, method, body, headers);
        this.#debug('RequestApi', response);
        if (response.error) {
          console.error('#requestApi: ', url, response);
          if (/IO error during request payload read/.test(response.error.message)) {
            return null;
          }
          throw new BaseError(`Error in request [${method}]: ${url}`);
        }
        break;
      } catch(error) {
        this.#debug('RequestApi', { url, error: `Retrying ${retry++} time(s)`, throwed: error });
      }
    }
    if (retry > NetSuiteService.#MAX_RETRIES) {
      throw new BaseError(`Max retries error in request [${method}]: ${url}`);
    }
    return response;
  }

  /**
   * Make the GET request to a specific endpoint
   * 
   * @param {string} url 
   * @param {*} headers 
   * @returns 
   */
  async requestGet(url, headers) {
    return this.#requestApi(url, 'GET', headers);
  }

  /**
   * Make the POST request to a specific endpoint
   * 
   * @param {string} url 
   * @param {*} body 
   * @param {*} headers 
   * @returns 
   */
  async requestPost(url, body, headers) {
    return this.#requestApi(url, 'POST', body, headers);
  }

  /**
   * Make the PUT request to a specific endpoint
   * 
   * @param {*} url 
   * @param {*} body 
   * @param {*} headers 
   * @param {*} debug 
   * @returns 
   */
  async requestPut(url, body, headers, debug) {
    return this.#requestApi(url, 'PUT', body, headers, debug);
  }

  /**
   * Make the DELETE request to a specific endpoint
   * 
   * @param {*} url 
   * @param {*} body 
   * @param {*} headers 
   * @returns 
   */
  async requestDelete(url, body, headers) {
    return this.#requestApi(url, 'DELETE', body, headers);
  }

  async #fileExists(filename) {
    return fs.access(filename, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Upload some file to a specific folder on Sharepoint
   * 
   * @param {string} attachmentDir - The path to a directory that contains the file to be uploaded
   * @param {string} folderName - the URL Path that will be save the file on Sharepoint (If the folder/path not exists will be created)
   * @param {string} file - The filename from the file that is inside of `attachmentDir` and will be saved on Sharepoint
   * @returns 
   * 
   * @example
   * // Will read '~/attachmentsDir/myfile.pdf' and put on 'me/drive/root/My Sharepoint Docs/myfile.pdf' on sharepoint
   * await msService.uploadFile('~/attachmentsDir', 'My Sharepoint Docs', 'myfile.pdf');
   */
  async uploadFile(attachmentDir, folderName, file) {
    const fileName = file.split('/').at(-1);
    // const urlFile = this.#sharepointFolder.concat(`:/${folderName}/${NormalizeUtils.encode(fileName)}:/content`);
    try {
      const filePath = attachmentDir.concat(`/${file}`);
      const fileExist = await this.#fileExists(filePath);
      this.#debug('uploadFile', `File exists? ${fileExist}`);
      if (!fileExist) {
        this.#debug('uploadFile', `File ${filePath} not exists.`);
        return null;
      }
      const fileContent = await fs.readFile(attachmentDir.concat(`/${file}`));
      const response = await this.requestPut(urlFile, fileContent);
      if (response?.error) {
        this.#debug('UploadFile', response.error);
        throw new BaseError(response.error?.message || 'Error in upload file');
      }
      return response;
    } catch (error) {
      this.#debug('UploadFile', { urlFile, error });
      throw new BaseError(`Cannot upload a new file in ${urlFile}`);
    }    
  }

  /**
   * Sign In on NetSuite get the access token and refresh token
   * 
   * @returns 
   */
  async signIn() {
    console.info('💡 NetSuite Authentication step\n');
    if (this.#nsAccessToken) {
      console.info('🔑 NetSuite access token already informed.\n');
      await this.#getMyInfo();
      return;
    }
    const authorizeUrl = this.#generateAuthorizeRequest();
    this.#nsCode = await prompt.question(`📢 Please open the following URL in your browser and follow the steps until you see a blank page:
${authorizeUrl}
    
When ready, please enter the value of the code parameter (from the URL of the blank page) and press return...\n`);
    prompt.close();
    console.log();
    await this.#requestAuthorizationToken(this.#nsCode);
  }

  /**
   * Log out - Clean all tokens
   */
  logout() {
    this.#nsState = null;
    this.#nsCode = null;
    this.#nsAccessToken = null;
    this.#nsRefreshToken = null;
  }

  /**
   * Execute query om SuiteQl
   * 
   * @param {string} query 
   * @returns {*}
   */
  async executeSuiteQl(query) {
    const body = JSON.stringify({
      q: query,
    });
    return this.requestPost('/query/v1/suiteql', body, {
      'Prefer': 'transient',
    });
  }
}
import fs from 'fs/promises';
import path from 'path';
import { BaseError, prompt } from '@maykoncapellari/cli-builder';
import { randomUUID } from 'crypto';
import NormalizeUtils from '../utils/normalize.utils.js';

/**
 * NetSuite Service
 * 
 * This class allow connect to netsuite, make the requests and download files from File Cabinet
 * 
 * @class
 * @example
 * const nsService = new NetSuiteService({ ...params });
 * await nsService.signIn();
 * const invoices = await nsService.requestGet('/record/v1/invoice');
 * console.log(invoices);
 * const files = await nsService.executeSuiteQl(`SELECT * FROM  MediaItemFolder WHERE id = '1253'`);
 * console.info(files);
 * const downloadFile = await nsService.downloadFile(524171, './');
 * await nsService.logout();
 */
export default class NetSuiteService {
  static #nsRedirectUri = 'https://login.live.com/oauth20_desktop.srf';
  static #nsAuthUrl = 'https://%s.app.netsuite.com/app/login/oauth2/authorize.nl';
  static #nsApiUrl = 'https://%s.suitetalk.api.netsuite.com/services/rest';
  static #nsRestletUrl = 'https://%s.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  static #nsBase64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
  static #nsScopes = 'restlets,rest_webservices';
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
  #nsScript;
  #nsDeploy;

  /**
   * The Params NetSuiteService.
   * 
   * @typedef {Object} NetSuiteServiceParams
   * @property {string} accountId - The NetSuite Account ID.
   * @property {string} client - The NetSuite APP ClientID.
   * @property {string} secret - The NetSuite APP ClientSecret.
   * @property {string} [script] - The NetSuite Script ID.
   * @property {string} [deploy] - The NetSuite Script deploy version.
   * @property {string} [token] - The NetSuite Access Token (When defined the client and secret is ignored)
   * @property {boolean} [debug] - Define debug mode (Default: false)
   * @property {boolean} [logToken] - Define if will log the access token after sigIn (Default: false)
   */

  /**
   * 
   * @constructor
   * @param {NetSuiteServiceParams} params
   */
  constructor({ accountId, client, secret, token, script, deploy, debug, logToken }) {
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
    this.#nsScript = script;
    this.#nsDeploy = deploy || 1;
    this.logout();
    this.#nsAccessToken = token;
    this.#isDebug = debug || process.env.MS_GRAPH_DEBUG === 'true';
    this.#shouldLogToken = logToken === 'true';
  }

  /**
   * Step One GET Request to the Authorization Endpoint
   * 
   * Generate the URL to authorize the request with the Consent Screen
   * 
   * @returns {string} The URL to authorize the request
   */
  #generateAuthorizeRequest() {
    this.#nsState = randomUUID();
    const nsServer = NetSuiteService.#nsAuthUrl.replace(/%s/, this.#nsAccountId);
    return `${nsServer}?client_id=${this.#nsClientId}&response_type=code&redirect_uri=${NetSuiteService.#nsRedirectUri}&scope=${NetSuiteService.#nsScopes}&state=${this.#nsState}`;
  }

  /**
   * Log messages in Debug mode
   * 
   * @param {string} path 
   * @param {*} message 
   */
  #debug(path, message) {
    if (this.#isDebug) {
      console.debug(`\n⚠️  ${path}`);
      console.debug(message);
      console.debug();
    }
  }

  /**
   * Log requests in Debug mode
   * 
   * @param {*} path 
   * @param {*} response 
   */
  #debugResponse(path, response) {
    const { url, status, statusText, body } = response;
    return this.#debug(path, { url, status, statusText, body });
  }

  /**
   * Return the token URL including the account ID
   * 
   * @returns {string}
   */
  #getTokenUrl() {
    return this.#getApiUrl().concat('/auth/oauth2/v1/token');
  }

  /**
   * Get header value used in the auth client in base64 (clientId:clientSecret)
   * 
   * @example
   * console.log(this.#getClientAuth());
   * //Y2xpZW50SWQ6Y2xpZW50U2VjcmV0
   * 
   * @returns {string}
   */
  #getClientAuth() {
    return Buffer.from(`${this.#nsClientId}:${this.#nsClientSecret}`).toString('base64');
  }

  /**
   * The Params AuthResponse.
   * 
   * @typedef {Object} AuthResponse
   * @property {string} access_token - The NetSuite Access Token.
   * @property {string} refresh_token - The NetSuite Refresh Token.
   * @property {string} expires_in - When the token will be expired in x seconds.
   * @property {string} token_type - The type of the token (Bearer).
   */

  /**
   * Step Two/Refresh Token POST Request to the Token Endpoint
   * 
   * Request to get the access token or to refresh some token
   * 
   * @param {string} token 
   * @param {authorization_code|refresh_token} grant_type 
   * @returns {AuthResponse} The response contain acces_token and refresh_token
   */
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

  /**
   * Set the tokens internally
   * 
   * @param {AuthResponse} authorization 
   */
  #setAuthorizationTokens(authorization) {
    this.#nsAccessToken = authorization.access_token;
    this.#nsRefreshToken = authorization.refresh_token;
    if(this.#shouldLogToken) {
      console.info('🔑 NetSuite Access Token: %s\n', this.#nsAccessToken);
    }
  }

  /**
   * Get the account records used only to validate the token
   * 
   * @returns {*}
   */
  async #getAccountInfo() {
    return this.requestGet('/record/v1/account');
  }

  /**
   * Return an object used on logs
   * 
   * @param {*} response 
   * @returns {*}
   */
  #getResponseLog(response) {
    const { url, status, statusText } = response;
    return { url, status, statusText };
  }

  /**
   * Refresh the token when is needed
   * 
   * @returns {AuthResponse}
   */
  async #refreshToken() {
    try {
      this.#debug('RefreshToken', this.#nsRefreshToken);
      return this.#requestAuthorizationToken(this.#nsRefreshToken, 'refresh_token');
    } catch (error) {
      this.#debug('RefreshToken', error);
      throw new BaseError('Cannot renew the current token, please try login again!');
    }
  }

  /**
   * Get the header auth object with the  bearer token
   * 
   * @returns {*}
   */
  #getAuthHeader() {
    return { 'Authorization': `Bearer ${this.#nsAccessToken}` };
  }

  /**
   * Make the internal request to Netsuite
   * 
   * @param {string} url - The url to send to NetSuite
   * @param {GET|POST|PUT|DELETE} method - The HTTP Method used on the request
   * @param {*} body - The body of the request
   * @param {*} headers - Some custom headers
   * @returns {*}
   */
  async #internalRequest(url, method, body, headers) {
    return fetch(url, {
      method,
      headers: {
        ...this.#getAuthHeader(),
        ...headers,
      },
      body,
    });
  }

  /**
   * Renew the token when this one is expired
   * 
   * @param {string} url - The url to send to NetSuite
   * @param {GET|POST|PUT|DELETE} method - The HTTP Method used on the request
   * @param {*} body - The body of the request
   * @param {*} headers - Some custom headers
   * @returns {*}
   */
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

  /**
   * Return the api URL used in requests to Netsuite
   * 
   * @returns {string}
   */
  #getApiUrl() {
    return NetSuiteService.#nsApiUrl.replace(/%s/, this.#nsAccountId);
  }

  /**
   * Make the requests to NetSuite
   * 
   * @param {string} url - The url to send to NetSuite
   * @param {GET|POST|PUT|DELETE} method - The HTTP Method used on the request
   * @param {*} body - The body of the request
   * @param {*} headers - Some custom headers
   * @returns {*}
   */
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
   * @returns {*}
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
   * @returns {*}
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
   * @returns {*}
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
   * @returns {*}
   */
  async requestDelete(url, body, headers) {
    return this.#requestApi(url, 'DELETE', body, headers);
  }

  /**
   * Get the restlet URL used on download file
   * @returns {string}
   */
  #getRestletUrl() {
    return `${NetSuiteService.#nsRestletUrl.replace(/%s/, this.#nsAccountId)}?script=${this.#nsScript}&deploy=${this.#nsDeploy}`;
  }

  /**
   * Check if file is encoded in base64
   * 
   * @param {string} file 
   * @returns {boolean}
   */
  #isFileInBase64(file) {
    return NetSuiteService.#nsBase64Regex.test(file);
  }

  /**
   * Download a file with ID from File Cabinet
   * 
   * @param {string|number} fileId - The id of the file on File Cabinet
   * @param {string} folderPath - The folder path to save the file
   * @returns {string} The file path from the downloaded file
   * 
   * @example
   * const downloadedFile = await msService.downloadFile('1234', '~/.');
   */
  async downloadFile(fileId, folderPath) {
    if (!this.#nsScript) {
      throw new BaseError('Script is required!');
    }
    try {
      const downloadUrl = this.#getRestletUrl();
      const body = JSON.stringify({ fileId });
      const fileObj = await fetch(downloadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.#getAuthHeader(),
        },
        body,
      }).then(async (response) => {
        if (!response.ok) {
          const error = await response.text();
          throw new BaseError(`Cannot download the file: ${downloadUrl} - ${response.statusText} - ${error}`);
        }
        return response.json(); 
      });

      const contentFile = this.#isFileInBase64(fileObj.content) 
        ? Buffer.from(fileObj.content, 'base64') 
        : fileObj.content;
      const downloadPath = path.resolve(folderPath, NormalizeUtils.normalize(fileObj.info.name));
      await fs.writeFile(downloadPath, contentFile);
      return downloadPath;
    } catch (error) {
      this.#debug('downloadFile', { fileId, error });
      throw new BaseError(`Cannot download the file ${fileId}`);
    }
  }

  /**
   * Sign In on NetSuite get the access token and refresh token
   */
  async signIn() {
    console.info('💡 NetSuite Authentication step\n');
    if (this.#nsAccessToken) {
      console.info('🔑 NetSuite access token already informed.\n');
      await this.#getAccountInfo();
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
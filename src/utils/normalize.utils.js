
/**
 * Normalize utils class
 * 
 * Helper methods to allow normalize, encode and decode texts
 * 
 * @class
 */
export default class NormalizeUtils {

  /**
   * Remove links in text
   * 
   * @param {string} text 
   * @returns {string}
   */
  static removeLinks(text) {
    return text.replace(/https?:\/\/[^ ~]+/g, '');
  }  
  
  /**
   * Normalize the text to put on netsuite
   * 
   * @static
   * @param {string} text - Text to be normalized
   * @returns 
   */
  static normalize(text) {
    return this.removeLinks(text).replace(/\*/g, '')
      .replace(/"|\{|\}|\*|:|<|>|\?|\/|\%|\+|\|/g, '')
      .replace(/\r|\t/g, '')
      .replace(/\n/g, ' - ')
      .replace(/\&/g, 'and')
      .replace(/\.+/, '.')
      .replace(/^~/, '')
      .replace(/^\.|\.$/, '')
      .replace(/\s+/, ' ')
      .trim();
  }

  /**
   * Normalize and encode the text using RFC 3986
   * 
   * @static
   * @param {string} text 
   * @returns {string}
   */
  static encode(text) {
    return this.encodeRFC3986URIComponent(this.normalize(text));
  }

  /**
   * Encode text using RFC 3986
   * 
   * @static
   * @param {string} str 
   * @returns {string}
   */
  static encodeRFC3986URIComponent(str) {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  /**
   * Normalize and decode text
   * 
   * @static
   * @param {string} text
   * @returns {string}
   */
  static decode(text) {
    return decodeURIComponent(this.normalize(text));
  }
}
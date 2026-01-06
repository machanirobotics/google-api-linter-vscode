import * as https from 'https';

/**
 * Fetches HTML content from a URL.
 * @param url - The URL to fetch from
 * @returns Promise resolving to the HTML content as a string
 */
export const fetchHtml = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
};

/**
 * Fetches and parses JSON from a URL.
 * @template T - The expected type of the JSON response
 * @param url - The URL to fetch from
 * @param headers - Optional HTTP headers to include in the request
 * @returns Promise resolving to the parsed JSON object
 */
export const fetchJson = <T>(url: string, headers: Record<string, string> = {}): Promise<T> => {
  return new Promise((resolve, reject) => {
    // Add User-Agent header for GitHub API
    const requestHeaders = {
      'User-Agent': 'vscode-google-api-linter',
      ...headers
    };
    
    https.get(url, { headers: requestHeaders }, (res) => {
      let data = '';
      
      // Check status code
      if (res.statusCode !== 200) {
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        });
        return;
      }
      
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Failed to parse JSON response. First 200 chars: ${data.substring(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
};

/**
 * Downloads a file from a URL to a local path, following redirects.
 * @param url - The URL to download from
 * @param dest - The destination file path
 * @param fs - The file system module (injected for testability)
 * @returns Promise that resolves when the download is complete
 */
export const downloadFile = (url: string, dest: string, fs: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    const request = (redirectUrl: string) => {
      https.get(redirectUrl, {
        headers: { 'User-Agent': 'vscode-google-api-linter' }
      }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const location = response.headers.location;
          if (location) {
            request(location);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
};

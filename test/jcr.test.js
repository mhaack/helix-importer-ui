/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs';
import { JSDOM } from 'jsdom';
import assert from 'assert';
import {
  getProcessedFileRef,
  getJcrPages,
  getJcrAssets,
  getJcrPaths,
  getPackageName,
} from '../js/shared/jcr.js';

const dom = new JSDOM();
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

const mockFetch = (url, imagePath, contentType) => {
// Save the original fetch function
  const originalFetch = global.fetch;
  // Read the image file as a Buffer
  const imageBuffer = fs.readFileSync(imagePath);
  // Override the global fetch function
  global.fetch = async (input, init) => {
    if (input === url) {
      // If the input matches the URL we want to mock, return a mock response
      return {
        ok: true,
        status: 200,
        headers: {
          get: (header) => (header === 'Content-Type' ? contentType : null),
        },
        blob: async () => imageBuffer,
      };
    }
    // Otherwise, call the original fetch function
    return originalFetch(input, init);
  };
};

// test cases and expected results
const testData = {
  siteName: 'repo',
  pages: [
    {
      url: 'https://www.brand.com/1/2/page.html',
      images: [
        {
          description: 'relative path to the page',
          fileReference: './a/b/media_0.png?param1=value1&param2=value2',
          expected: {
            add: true,
            fileReference: './a/b/media_0.png?param1=value1&param2=value2',
            jcrPath: '/content/dam/repo/1/2/a/b/media_0_param1value1_param2value2.png',
            processedFileRef: '/content/dam/repo/1/2/a/b/media_0_param1value1_param2value2.png',
            url: new URL('https://www.brand.com/1/2/a/b/media_0.png?param1=value1&param2=value2'),
          },
        },
        {
          description: 'absolute path',
          fileReference: '/a/b/media_1.png',
          expected: {
            add: true,
            fileReference: '/a/b/media_1.png',
            jcrPath: '/content/dam/repo/a/b/media_1.png',
            processedFileRef: '/content/dam/repo/a/b/media_1.png',
            url: new URL('https://www.brand.com/a/b/media_1.png'),
          },
        },
        {
          description: 'absolute path, duplicate',
          fileReference: '/a/b/media_1.png',
          expected: {
            add: false,
            fileReference: '/a/b/media_1.png',
            jcrPath: '/content/dam/repo/a/b/media_1.png',
            processedFileRef: '/content/dam/repo/a/b/media_1.png',
            url: new URL('https://www.brand.com/a/b/media_1.png'),
          },
        },
        {
          description: 'absolute path, no extension',
          fileReference: '/a/b/media_1a',
          expected: {
            add: true,
            fileReference: '/a/b/media_1a',
            jcrPath: '/content/dam/repo/a/b/media_1a',
            processedFileRef: '/content/dam/repo/a/b/media_1a',
            url: new URL('https://www.brand.com/a/b/media_1a'),
          },
        },
      ],
      expected: {
        jcrPath: '/content/repo/1/2/page',
        contentXmlPath: 'jcr_root/content/repo/1/2/page/.content.xml',
        pageContentChildren: [
          'root',
        ],
        pageProperties: [
          'cq:template',
          'jcr:primaryType',
          'jcr:title',
          'sling:resourceType',
        ],
      },
    },
    {
      url: 'https://www.brand.com/3/4/page.html',
      images: [
        {
          description: 'external URL, different domain than the page',
          fileReference: 'https://www.mysite.com/a/b/media_2.png?param1=value1&param2=value2',
          expected: {
            add: false,
            fileReference: 'https://www.mysite.com/a/b/media_2.png?param1=value1&param2=value2',
            jcrPath: undefined,
            processedFileRef: 'https://www.mysite.com/a/b/media_2.png?param1=value1&param2=value2',
            url: new URL('https://www.mysite.com/a/b/media_2.png?param1=value1&param2=value2'),
            mimeType: 'image/png',
          },
        },
        {
          description: 'external URL, same domain as the page',
          fileReference: 'https://www.brand.com/a/b/media_2.png?param1=value1&param2=value2',
          expected: {
            add: true,
            fileReference: 'https://www.brand.com/a/b/media_2.png?param1=value1&param2=value2',
            jcrPath: '/content/dam/repo/a/b/media_2_param1value1_param2value2.png',
            processedFileRef: '/content/dam/repo/a/b/media_2_param1value1_param2value2.png',
            url: new URL('https://www.brand.com/a/b/media_2.png?param1=value1&param2=value2'),
          },
        },
        {
          description: 'below /content/dam, below the same site name',
          fileReference: '/content/dam/repo/a/b/media_3.png?param1=value1&param2=value2',
          expected: {
            add: true,
            fileReference: '/content/dam/repo/a/b/media_3.png?param1=value1&param2=value2',
            jcrPath: '/content/dam/repo/a/b/media_3.png',
            processedFileRef: '/content/dam/repo/a/b/media_3.png',
            url: new URL('https://www.brand.com/content/dam/repo/a/b/media_3.png?param1=value1&param2=value2'),
          },
        },
        {
          description: 'below /content/dam, below another site name',
          fileReference: '/content/dam/site2/a/b/media_4.png?param1=value1',
          expected: {
            add: true,
            fileReference: '/content/dam/site2/a/b/media_4.png?param1=value1',
            jcrPath: '/content/dam/repo/a/b/media_4.png',
            processedFileRef: '/content/dam/repo/a/b/media_4.png',
            url: new URL('https://www.brand.com/content/dam/site2/a/b/media_4.png?param1=value1'),
          },
        },
      ],
      expected: {
        jcrPath: '/content/repo/3/4/page',
        contentXmlPath: 'jcr_root/content/repo/3/4/page/.content.xml',
        pageContentChildren: [
          'root',
        ],
        pageProperties: [
          'cq:template',
          'jcr:primaryType',
          'jcr:title',
          'sling:resourceType',
        ],
      },
    },
  ],
  expectedJcrPaths: [
    '/content/repo/1/2/page',
    '/content/repo/3/4/page',
    '/content/dam/repo/1/2/a/b/media_0_param1value1_param2value2.png',
    '/content/dam/repo/a/b/media_1.png',
    '/content/dam/repo/a/b/media_1a',
    '/content/dam/repo/a/b/media_2_param1value1_param2value2.png',
    '/content/dam/repo/a/b/media_3.png',
    '/content/dam/repo/a/b/media_4.png',
  ],
};

const fileReferenceMimeTypeXml = (mimeType) => {
  if (mimeType) {
    return ` fileReferenceMimeType="${mimeType}"`;
  }
  return '';
};

const pageXml = (images) => `<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
      <jcr:content cq:template="/libs/core/franklin/templates/page" jcr:primaryType="cq:PageContent" jcr:title="Sites Franklin Example" sling:resourceType="core/franklin/components/page/v1/page">
        <root jcr:primaryType="nt:unstructured" sling:resourceType="core/franklin/components/root/v1/root">
          <section sling:resourceType="core/franklin/components/section/v1/section" jcr:primaryType="nt:unstructured">
            ${images.map((image, i) => `<image_${i} sling:resourceType="core/franklin/components/image/v1/image" jcr:primaryType="nt:unstructured" alt="" fileReference="${image.fileReference.replace('&', '&amp;')}"${fileReferenceMimeTypeXml(image.mimeType)}/>`).join('')}
            <button_0 sling:resourceType="core/franklin/components/button/v1/button" jcr:primaryType="nt:unstructured" type="primary" href="/acrobat/free-trial-download.html" text="7-day free trial"/>
          </section>
        </root>
      </jcr:content>
    </jcr:root>`;

const testPages = testData.pages.map((page) => ({
  path: new URL(page.url).pathname.split('.html')[0],
  data: pageXml(page.images.map((image) => ({
    fileReference: image.fileReference,
  }))),
  url: page.url,
}));

describe('JCR Importer', () => {
  before(() => {
    mockFetch('https://www.mysite.com/a/b/media_2.png?param1=value1&param2=value2', 'test/resources/adobe-logo.png', 'image/png');
  });
  it('should return the correct JCR package name', () => {
    assert.deepEqual(getPackageName(testPages, testData.siteName), 'repo', 'Package name is not as expected');
  });

  it('should return the correct JCR processed fileReference', () => {
    const testGetProcessedFileRef = (siteName, pageUrl, fileReference, expected) => {
      const result = getProcessedFileRef(fileReference, pageUrl, siteName);
      assert.equal(result, expected, `Processed file reference is not as expected for ${fileReference}`);
    };

    testData.pages.forEach((page) => {
      page.images.forEach((image) => {
        const { fileReference, expected } = image;
        const pageUrl = page.url;
        // eslint-disable-next-line max-len
        testGetProcessedFileRef(testData.siteName, pageUrl, fileReference, expected.processedFileRef);
      });
    });
  });

  it('should return the correct JCR pages', async () => {
    const expectedPages = testData.pages.map((page) => ({
      path: new URL(page.url).pathname.split('.html')[0],
      sourceXml: pageXml(page.images.map((image) => ({
        fileReference: image.fileReference,
      }))),
      processedXml: pageXml(page.images.map((image) => ({
        fileReference: image.expected.processedFileRef,
        mimeType: image.expected.mimeType,
      }))),
      jcrPath: page.expected.jcrPath,
      contentXmlPath: page.expected.contentXmlPath,
      url: page.url,
      pageContentChildren: page.expected.pageContentChildren,
      pageProperties: page.expected.pageProperties,
    }));
    const actualPages = await getJcrPages(testPages, testData.siteName);
    assert.deepEqual(actualPages, expectedPages, 'JCR pages are not as expected');
  });

  it('should return the correct JCR assets', async () => {
    const expectedAssets = testData.pages
      .flatMap((page) => page.images)
      .map((image) => (image.expected))
      .filter((image) => image.add);
    const actualAssets = await getJcrAssets(testPages, testData.siteName);
    assert.deepEqual(actualAssets, expectedAssets, 'JCR assets are not as expected');
  });

  it('should return the correct JCR paths', async () => {
    const expectedPaths = testData.expectedJcrPaths;
    const actualPaths = await getJcrPaths(testPages, testData.siteName);
    assert.deepEqual(actualPaths, expectedPaths, 'JCR paths are not as expected');
  });
});

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
/* global JSZip */
import { saveFile } from './filesystem.js';

// By default, the site name is the GitHub repository name:
// you can force a different site name as a string, e.g. 'my-site'
const CUSTOM_SITE_NAME_DEFAULT = undefined;
const CUSTOM_SITE_NAME = CUSTOM_SITE_NAME_DEFAULT;
// By default, the page assets are added to the package:
// you can disable this by setting this to false
const ADD_ASSET_TO_PACKAGE_DEFAULT = true;
const ADD_ASSET_TO_PACKAGE = ADD_ASSET_TO_PACKAGE_DEFAULT;

// cache for pages and assets
let jcrPages = [];
let jcrAssets = [];

const init = () => {
  jcrPages = [];
  jcrAssets = [];
};

export const loadComponents = async (projectUrl) => {
  const components = {};
  if (projectUrl) {
    const [
      componentModels, componentsDefinition, componentFilters,
    ] = await Promise.all([
      fetch(`${projectUrl}/component-models.json`).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch component-models.json: ${res.status}`);
        } else {
          return res.text();
        }
      }),
      fetch(`${projectUrl}/component-definition.json`).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch component-definition.json: ${res.status}`);
        } else {
          return res.text();
        }
      }),
      fetch(`${projectUrl}/component-filters.json`).then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch component-filters.json: ${res.status}`);
        } else {
          return res.text();
        }
      }),
    ]);
    components.componentModels = JSON.parse(componentModels);
    components.componentDefinition = JSON.parse(componentsDefinition);
    components.filters = JSON.parse(componentFilters);
  }
  return components;
};

const getSiteName = (projectUrl) => {
  if (CUSTOM_SITE_NAME) {
    return CUSTOM_SITE_NAME;
  }
  const u = new URL(projectUrl);
  return u.pathname.split('/')[2];
};

export const getPackageName = (pages, projectUrl) => {
  const siteName = getSiteName(projectUrl);
  if (pages.length === 1) {
    const pageName = pages[0].path.split('/').pop();
    return `${siteName}_${pageName}`;
  }
  return siteName;
};

const getJcrPagePath = (path, projectUrl) => {
  const siteName = getSiteName(projectUrl);
  if (path.startsWith('/content/')) {
    // replace the 2nd token with the site name
    const tokens = path.split('/');
    tokens.splice(2, 1, siteName);
    return tokens.join('/');
  }
  return `/content/${siteName}${path}`;
};

const getJcrAssetPath = (assetUrl, projectUrl) => {
  const siteName = getSiteName(projectUrl);
  // add the query parameters to the path as _name1value1_name2value2
  const params = assetUrl.searchParams;
  const extension = (assetUrl.pathname.includes('.')) ? `.${assetUrl.pathname.split('.').pop()}` : '';
  const path = assetUrl.pathname.replace(extension, '');
  if (path.startsWith('/content/dam/')) {
    // replace the 3rd token with the site name
    const tokens = path.split('/');
    tokens.splice(3, 1, siteName);
    return `${tokens.join('/')}${extension}`;
  }
  const suffix = Array.from(params.keys()).map((key) => `_${key}${params.get(key)}`).join('');
  return `/content/dam/${siteName}${path}${suffix}${extension}`;
};

const getMimeTypeFromExtension = (extension) => {
  const mimeTypes = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif',
  };
  return mimeTypes[extension];
};

const getAssetXml = (mimeType) => `<?xml version="1.0" encoding="UTF-8"?>
    <jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:dam="http://www.day.com/dam/1.0" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:mix="http://www.jcp.org/jcr/mix/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/"
        jcr:mixinTypes="[mix:referenceable]"
        jcr:primaryType="dam:Asset">
        <jcr:content
            jcr:primaryType="dam:AssetContent">
            <metadata
                dc:format="${mimeType}"
                jcr:mixinTypes="[cq:Taggable]"
                jcr:primaryType="nt:unstructured"/>
            <related jcr:primaryType="nt:unstructured"/>
        </jcr:content>
    </jcr:root>`;

// Fetches the asset blob and mime type
const fetchAssetData = async (asset) => {
  if (asset.url) {
    const { blob, mimeType } = await fetch(asset.url.href)
      .then(async (res) => {
        if (!res.ok) {
          // eslint-disable-next-line no-console
          console.error(`Failed to fetch image: ${res.status}`);
          return { blob: null, mimeType: null };
        }
        return { blob: await res.blob(), mimeType: res.headers.get('content-type') };
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`Fetch failed with error: ${error}`);
      });
    asset.blob = blob;
    asset.mimeType = mimeType || getMimeTypeFromExtension(asset.url.pathname.split('.').pop());
  }
};

const getAsset = (fileReference, pageUrl, projectUrl) => {
  if (!fileReference || fileReference === '') {
    return null;
  }
  const host = new URL(pageUrl).origin;
  let jcrPath;
  let processedFileRef = fileReference;
  let url;
  let add = false;
  const pagePath = new URL(pageUrl).pathname;
  if (fileReference.startsWith('http')) {
    // external fileReference
    url = new URL(fileReference);
    if (url.origin === host) {
      // the asset is hosted on the same server
      jcrPath = getJcrAssetPath(url, projectUrl);
      processedFileRef = jcrPath;
      add = true;
    }
  } else if (fileReference.startsWith('/content/dam/')) {
    // DAM fileReference
    url = new URL(`${host}${fileReference}`);
    jcrPath = getJcrAssetPath(url, projectUrl);
    processedFileRef = jcrPath;
    add = ADD_ASSET_TO_PACKAGE;
  } else if (fileReference.startsWith('/')) {
    // absolute fileReference
    url = new URL(`${host}${fileReference}`);
    jcrPath = getJcrAssetPath(url, projectUrl);
    processedFileRef = jcrPath;
    add = true;
  } else if (fileReference.startsWith('./')) {
    // relative fileReference: use the page path to make it an absolute path
    const parentPath = pagePath.substring(0, pagePath.lastIndexOf('/'));
    // eslint-disable-next-line no-param-reassign
    url = new URL(`${host}${parentPath}${fileReference.substring(1)}`);
    jcrPath = getJcrAssetPath(url, projectUrl);
    processedFileRef = jcrPath;
    add = true;
  }
  return {
    fileReference,
    processedFileRef,
    jcrPath,
    url,
    add,
  };
};

export const getProcessedFileRef = (fileReference, pageUrl, projectUrl) => {
  const asset = getAsset(fileReference, pageUrl, projectUrl);
  return asset.processedFileRef;
};

const addAsset = async (asset, dirHandle, prefix, zip) => {
  // get asset blob and mime type
  await fetchAssetData(asset);

  // add the image .content.xml file
  const zipAssetPath = `jcr_root${asset.jcrPath}/.content.xml`;
  const fileAssetPath = `${prefix}/${zipAssetPath}`;
  const assetXml = getAssetXml(asset.mimeType);
  await zip.file(zipAssetPath, assetXml);
  await saveFile(dirHandle, fileAssetPath, assetXml);

  // add the image original file
  const zipAssetOriginalPath = `jcr_root${asset.jcrPath}/_jcr_content/renditions/original`;
  const fileAssetOriginalPath = `${prefix}/${zipAssetOriginalPath}`;
  await zip.file(zipAssetOriginalPath, asset.blob);
  await saveFile(dirHandle, fileAssetOriginalPath, asset.blob);
};

const addPage = async (page, dirHandle, prefix, zip) => {
  zip.file(page.contentXmlPath, page.processedXml);
  await saveFile(dirHandle, `${prefix}/${page.contentXmlPath}`, page.processedXml);
};

const getResourcePaths = (resources, isAsset) => resources
  .map((resource) => {
    if ((isAsset && resource.add && resource.jcrPath) || (!isAsset && resource.jcrPath)) {
      return resource.jcrPath;
    }
    return null;
  })
  .filter((path) => path !== null);

const getPropertiesXml = (packageName) => {
  const author = 'anonymous';
  const now = new Date().toISOString();
  const propXml = `<?xml version='1.0' encoding='UTF-8'?>
    <!DOCTYPE properties SYSTEM 'http://java.sun.com/dtd/properties.dtd'>
    <properties>
    <comment>FileVault Package Properties</comment>
    <entry key='description'></entry>
    <entry key='generator'>org.apache.jackrabbit.vault:3.7.1-T20231005151103-335689a8</entry>
    <entry key='packageType'>content</entry>
    <entry key='lastWrappedBy'>${author}</entry>
    <entry key='packageFormatVersion'>2</entry>
    <entry key='group'>my_packages</entry>
    <entry key='created'>${now}</entry>
    <entry key='lastModifiedBy'>${author}</entry>
    <entry key='buildCount'>1</entry>
    <entry key='lastWrapped'>${now}</entry>
    <entry key='version'></entry>
    <entry key='dependencies'></entry>
    <entry key='createdBy'>${author}</entry>
    <entry key='name'>${packageName}</entry>
    <entry key='lastModified'>${now}</entry>
    </properties>`;
  const propXmlPath = 'META-INF/vault/properties.xml';
  return { propXmlPath, propXml };
};

// Updates the asset references in the JCR XML
export const getProcessedJcr = async (xml, pageUrl, projectUrl) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const images = doc.querySelectorAll('[fileReference]');
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const fileReference = image.getAttribute('fileReference');
    const processedFileRef = getProcessedFileRef(fileReference, pageUrl, projectUrl);
    if (fileReference.startsWith('http')) {
      // External fileReference: add the asset mime type to the page XML
      const asset = getAsset(fileReference, pageUrl, projectUrl);
      if (!asset.add) {
        // eslint-disable-next-line no-await-in-loop
        await fetchAssetData(asset);
        if (asset.mimeType && asset.mimeType !== '') {
          image.setAttribute('fileReferenceMimeType', asset.mimeType);
        }
      }
    }
    image.setAttribute('fileReference', processedFileRef);
  }
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
};

const getPageProperties = (xml) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  // get the jcr:content node properties
  const namespaceURI = 'http://www.jcp.org/jcr/1.0';
  const localName = 'content';
  const jcrContent = doc.getElementsByTagNameNS(namespaceURI, localName)[0];
  // eslint-disable-next-line max-len
  return jcrContent ? jcrContent.getAttributeNames() : [];
};

const getPageContentChildren = (xml) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  // get the names of the jcr:content node children
  const namespaceURI = 'http://www.jcp.org/jcr/1.0';
  const localName = 'content';
  const jcrContent = doc.getElementsByTagNameNS(namespaceURI, localName)[0];
  const children = jcrContent?.children;
  return children ? Array.from(children).map((child) => child.tagName) : [];
};

export const getJcrPages = async (pages, projectUrl) => {
  if (jcrPages.length === 0) {
    jcrPages = Promise.all(pages.map(async (page) => ({
      path: page.path,
      sourceXml: page.data,
      pageProperties: getPageProperties(page.data),
      pageContentChildren: getPageContentChildren(page.data),
      processedXml: await getProcessedJcr(page.data, page.url, projectUrl),
      jcrPath: getJcrPagePath(page.path, projectUrl),
      contentXmlPath: `jcr_root${getJcrPagePath(page.path, projectUrl)}/.content.xml`,
      url: page.url,
    })));
  }
  return jcrPages;
};

export const getJcrAssets = async (pages, projectUrl) => {
  if (jcrAssets.length === 0) {
    jcrPages = await getJcrPages(pages, projectUrl);
    for (let i = 0; i < jcrPages.length; i += 1) {
      const page = jcrPages[i];
      const parser = new DOMParser();
      const doc = parser.parseFromString(page.sourceXml, 'text/xml');
      const images = doc.querySelectorAll('[fileReference]');
      for (let j = 0; j < images.length; j += 1) {
        const image = images[j];
        const fileReference = image.getAttribute('fileReference');
        const asset = getAsset(fileReference, page.url, projectUrl);
        // add if not a duplicate
        if (asset && asset.add && !jcrAssets.find((a) => a.jcrPath === asset.jcrPath)) {
          jcrAssets.push(asset);
        }
      }
    }
  }
  return jcrAssets;
};

export const getJcrPaths = async (pages, projectUrl) => {
  jcrPages = await getJcrPages(pages, projectUrl);
  jcrAssets = await getJcrAssets(pages, projectUrl);
  const jcrPaths = [];
  jcrPaths.push(...getResourcePaths(jcrPages, false));
  jcrPaths.push(...getResourcePaths(jcrAssets, true));
  return jcrPaths;
};

export const getJcrAssetPaths = async (pages, projectUrl) => {
  jcrAssets = await getJcrAssets(pages, projectUrl);
  const jcrPaths = [];
  jcrPaths.push(...getResourcePaths(jcrAssets, true));
  return jcrPaths;
};

const getEmptyAncestorPages = (pages) => {
  const jcrPaths = pages.map((page) => page.jcrPath);
  const emptyAncestors = [];
  const ancestorXml = `<?xml version="1.0" encoding="UTF-8"?>
    <jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" xmlns:nt="http://www.jcp.org/jcr/nt/1.0" xmlns:cq="http://www.day.com/jcr/cq/1.0" xmlns:sling="http://sling.apache.org/jcr/sling/1.0" jcr:primaryType="cq:Page">
        <jcr:content cq:template="/libs/core/franklin/templates/page" jcr:primaryType="cq:PageContent" sling:resourceType="core/franklin/components/page/v1/page"/>
    </jcr:root>`;

  jcrPaths.forEach((pagePath) => {
    const pathSegments = pagePath.split('/');
    let ancestorPath = '/content';

    for (let i = 2; i < pathSegments.length - 1; i += 1) {
      ancestorPath += `/${pathSegments[i]}`;

      if (!jcrPaths.includes(ancestorPath)) {
        emptyAncestors.push({
          jcrPath: ancestorPath,
          contentXmlPath: `jcr_root${ancestorPath}/.content.xml`,
          processedXml: ancestorXml,
        });
      }
    }
  });

  return emptyAncestors;
};

const getFilterXml = async (pages, projectUrl) => {
  jcrPages = await getJcrPages(pages, projectUrl);

  const pageFilters = jcrPages.reduce((acc, page) => {
    const propertiesFilter = page.pageProperties.map((prop) => `<include pattern='${page.jcrPath}/jcr:content/${prop}' matchProperties='true'/>`).join('\n');
    const childrenFilter = page.pageContentChildren.map((child) => `<filter root='${page.jcrPath}/jcr:content/${child}'/>`).join('\n');
    return `${acc}<filter root='${page.jcrPath}/jcr:content'>\n${propertiesFilter}\n</filter>\n${childrenFilter}\n`;
  }, '');

  const jcrAssetPaths = await getJcrAssetPaths(pages, projectUrl);
  const assetFilters = jcrAssetPaths.reduce((acc, path) => `${acc}<filter root='${path}'/>\n`, '');

  const filterXml = `<?xml version='1.0' encoding='UTF-8'?>
    <workspaceFilter version='1.0'>
      ${pageFilters}
      ${assetFilters}
    </workspaceFilter>`;
  const filterXmlPath = 'META-INF/vault/filter.xml';
  return { filterXmlPath, filterXml };
};

const addFilterXml = async (pages, projectUrl, dirHandle, prefix, zip) => {
  const { filterXmlPath, filterXml } = await getFilterXml(pages, projectUrl);
  zip.file(filterXmlPath, filterXml);
  await saveFile(dirHandle, `${prefix}/${filterXmlPath}`, filterXml);
};

const addPropertiesXml = async (dirHandle, prefix, zip, pages, packageName) => {
  const { propXmlPath, propXml } = getPropertiesXml(packageName);
  zip.file(propXmlPath, propXml);
  await saveFile(dirHandle, `${prefix}/${propXmlPath}`, propXml);
};

export const createJcrPackage = async (dirHandle, pages, projectUrl) => {
  if (pages.length === 0) return;
  init();
  const packageName = getPackageName(pages, projectUrl);
  const zip = new JSZip();
  const prefix = 'jcr';

  // add the pages
  jcrPages = await getJcrPages(pages, projectUrl);
  for (let i = 0; i < jcrPages.length; i += 1) {
    const page = jcrPages[i];
    // eslint-disable-next-line no-await-in-loop
    await addPage(page, dirHandle, prefix, zip);
  }

  // add the empty ancestor pages
  const emptyAncestorPages = getEmptyAncestorPages(jcrPages);
  for (let i = 0; i < emptyAncestorPages.length; i += 1) {
    const page = emptyAncestorPages[i];
    // eslint-disable-next-line no-await-in-loop
    await addPage(page, dirHandle, prefix, zip);
  }

  // add the assets
  jcrAssets = await getJcrAssets(pages, projectUrl);
  for (let i = 0; i < jcrAssets.length; i += 1) {
    const asset = jcrAssets[i];
    // eslint-disable-next-line no-await-in-loop
    await addAsset(asset, dirHandle, prefix, zip);
  }

  // add the filter.xml file
  await addFilterXml(pages, projectUrl, dirHandle, prefix, zip);

  // add the properties.xml file
  await addPropertiesXml(dirHandle, prefix, zip, pages, packageName);

  // save the zip file
  zip.generateAsync({ type: 'blob' })
    .then(async (blob) => {
      await saveFile(dirHandle, `${prefix}/${packageName}.zip`, blob);
    });
};

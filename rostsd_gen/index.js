/* eslint-disable max-depth */
/* eslint-disable no-sync */
/* eslint-disable camelcase */
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// create interfaces.d.ts containing from each typeclass definition
/* Example output for std_msgs_msg_String
declare module "rclnodejs" {
  namespace std_msgs {
	  namespace msg {
			export type String = {
				data: string
			}
		}
	}
}
*/

'use strict';

const path = require('path');
const fs = require('fs');
const loader = require('../lib/interface_loader.js');
const pkgFilters = require('../rosidl_gen/filter.js');

async function generateAll() {
  // load pkg and interface info (msgs and srvs)
  const generatedPath = path.join(__dirname, '../generated/');
  const pkgInfos = getPkgInfos(generatedPath);

  // write interfaces.d.ts file
  const interfacesFilePath = path.join(__dirname, '../types/interfaces.d.ts');
  const fd = fs.openSync(interfacesFilePath, 'w');
  savePkgInfoAsTSD(pkgInfos, fd);
  await wait(500); // hack to avoid random segfault
  fs.closeSync(fd);
}

// scan generated files, i.e., rootDir, and collect pkg and ROS2 interface info
function getPkgInfos(rootDir) {
  let pkgInfos = [];
  let pkgs = fs.readdirSync(rootDir);

  for (let pkg of pkgs) {
    if (pkg.endsWith('.json')) continue;

    const pkgInfo = {
      name: pkg,
      subfolders: new Map(),
    };

    const pkgPath = path.join(rootDir, pkg);
    const files = fs.readdirSync(pkgPath).filter((fn) => fn.endsWith('.js'));

    for (let filename of files) {
      const typeClass = fileName2Typeclass(filename);
      if (
        !typeClass.type ||
        pkgFilters.matchesAny({
          pkgName: typeClass.package,
          interfaceName: typeClass.name,
        })
      )
        continue;

      const rosInterface = loader.loadInterface(typeClass);

      if (!pkgInfo.subfolders.has(typeClass.type)) {
        pkgInfo.subfolders.set(typeClass.type, []);
      }

      pkgInfo.subfolders.get(typeClass.type).push(rosInterface);
    }

    pkgInfos.push(pkgInfo);
  }

  return pkgInfos;
}

function savePkgInfoAsTSD(pkgInfos, fd) {
  const messagesMap = {
    string: 'string',
  };
  const servicesMap = {};
  const actionsMap = {};

  fs.writeSync(fd, '/* eslint-disable camelcase */\n');
  fs.writeSync(fd, '/* eslint-disable max-len */\n');
  fs.writeSync(fd, '// DO NOT EDIT\n');
  fs.writeSync(fd, '// This file is generated by the rostsd_gen script\n\n');

  fs.writeSync(fd, "declare module 'rclnodejs' {\n");

  for (const pkgInfo of pkgInfos) {
    if (pkgInfo.subfolders.size === 0) continue;

    // write namespaces heirarchy for package
    fs.writeSync(fd, `  namespace ${pkgInfo.name} {\n`);

    for (const subfolder of pkgInfo.subfolders.keys()) {
      fs.writeSync(fd, `    namespace ${subfolder} {\n`);

      for (const rosInterface of pkgInfo.subfolders.get(subfolder)) {
        const type = rosInterface.type();
        const fullInterfaceName = `${type.pkgName}/${type.subFolder}/${type.interfaceName}`;
        const fullInterfacePath = `${type.pkgName}.${type.subFolder}.${type.interfaceName}`;
        const fullInterfaceConstructor = fullInterfacePath + 'Constructor';

        if (isMsgInterface(rosInterface)) {
          // create message interface
          saveMsgAsTSD(rosInterface, fd);
          saveMsgConstructorAsTSD(rosInterface, fd);
          messagesMap[fullInterfaceName] = fullInterfacePath;
        } else if (isSrvInterface(rosInterface)) {
          if (
            !isValidService(rosInterface, pkgInfo.subfolders.get(subfolder))
          ) {
            let type = rosInterface.type();
            console.log(
              `Incomplete service: ${type.pkgName}.${type.subFolder}.${type.interfaceName}.`
            );
            continue;
          }

          // create service interface
          saveSrvAsTSD(rosInterface, fd);
          if (!isInternalActionSrvInterface(rosInterface)) {
            servicesMap[fullInterfaceName] = fullInterfaceConstructor;
          }
        } else if (isActionInterface(rosInterface)) {
          if (!isValidAction(rosInterface, pkgInfo.subfolders.get(subfolder))) {
            let type = rosInterface.type();
            console.log(
              `Incomplete action: ${type.pkgName}.${type.subFolder}.${type.interfaceName}.`
            );
            continue;
          }

          // create action interface
          saveActionAsTSD(rosInterface, fd);
          actionsMap[fullInterfaceName] = fullInterfaceConstructor;
        }
      }

      // close namespace declare
      fs.writeSync(fd, '    }\n');
    }

    // close pkg level namespace declare
    fs.writeSync(fd, '  }\n\n');
  }

  // write messages type mappings
  fs.writeSync(fd, '  type MessagesMap = {\n');
  for (const key in messagesMap) {
    fs.writeSync(fd, `    '${key}': ${messagesMap[key]},\n`);
  }
  fs.writeSync(fd, '  };\n');
  fs.writeSync(fd, '  type MessageTypeClassName = keyof MessagesMap;\n');
  fs.writeSync(fd, '  type Message = MessagesMap[MessageTypeClassName];\n');
  fs.writeSync(
    fd,
    '  type MessageType<T> = T extends MessageTypeClassName ? MessagesMap[T] : object;\n\n'
  );

  // write message contructor mappings
  fs.writeSync(fd, '  type MessageTypeClassConstructorMap = {\n');
  for (const key in messagesMap) {
    if (key === 'string') {
      fs.writeSync(fd, "    'string': never,\n");
      continue;
    }
    fs.writeSync(fd, `    '${key}': ${messagesMap[key]}Constructor,\n`);
  }
  fs.writeSync(fd, '  };\n');
  fs.writeSync(
    fd,
    '  type MessageConstructorType<T> = ' +
      'T extends MessageTypeClassName ? MessageTypeClassConstructorMap[T] : object;\n\n'
  );

  // write services type mappings
  fs.writeSync(fd, '  type ServicesMap = {\n');
  for (const key in servicesMap) {
    fs.writeSync(fd, `    '${key}': ${servicesMap[key]},\n`);
  }
  fs.writeSync(fd, '  };\n');
  fs.writeSync(fd, '  type ServiceTypeClassName = keyof ServicesMap;\n');
  fs.writeSync(fd, '  type Service = ServicesMap[ServiceTypeClassName];\n');
  fs.writeSync(
    fd,
    '  type ServiceType<T> = T extends ServiceTypeClassName ? ServicesMap[T] : object;\n\n'
  );

  // write actions type mappings
  fs.writeSync(fd, '  type ActionsMap = {\n');
  for (const key in actionsMap) {
    fs.writeSync(fd, `    '${key}': ${actionsMap[key]},\n`);
  }
  fs.writeSync(fd, '  };\n');
  fs.writeSync(fd, '  type ActionTypeClassName = keyof ActionsMap;\n');
  fs.writeSync(fd, '  type Action = ActionsMap[ActionTypeClassName];\n');
  fs.writeSync(
    fd,
    '  type ActionType<T> = T extends ActionTypeClassName ? ActionsMap[T] : object;\n\n'
  );

  fs.writeSync(
    fd,
    '  type TypeClassName = MessageTypeClassName | ServiceTypeClassName | ActionTypeClassName;\n'
  );
  fs.writeSync(
    fd,
    '  type InterfaceType<T> = T extends TypeClassName ? ' +
      '(MessageTypeClassConstructorMap & ServicesMap & ActionsMap)[T] : object;\n'
  );

  // close module declare
  fs.writeSync(fd, '}\n');
}

function saveMsgAsTSD(rosMsgInterface, fd) {
  fs.writeSync(
    fd,
    `      export interface ${rosMsgInterface.type().interfaceName} {\n`
  );
  const useSamePkg =
    isInternalActionMsgInterface(rosMsgInterface) ||
    isInternalServiceEventMsgInterface(rosMsgInterface);
  saveMsgFieldsAsTSD(rosMsgInterface, fd, 8, ';', '', useSamePkg);
  fs.writeSync(fd, '      }\n');
}

/**
 * Writes the message fields as typescript definitions.
 *
 * @param {*} rosMsgInterface ros message
 * @param {*} fd file descriptor
 * @param {string} indent The amount of indent, in spaces
 * @param {string} lineEnd The character to put at the end of each line, usually ','
 * or ';'
 * @param {string} typePrefix The prefix to put before the type name for
 * non-primitive types
 * @param {boolean} useSamePackageSubFolder Indicates if the sub folder name should be taken from the message
 * when the field type comes from the same package. This is needed for action interfaces. Defaults to false.
 * @returns {undefined}
 */
function saveMsgFieldsAsTSD(
  rosMsgInterface,
  fd,
  indent = 0,
  lineEnd = ',',
  typePrefix = '',
  useSamePackageSubFolder = false
) {
  let type = rosMsgInterface.type();
  let fields = rosMsgInterface.ROSMessageDef.fields;

  for (const field of fields) {
    let subFolder =
      useSamePackageSubFolder && field.type.pkgName === type.pkgName
        ? type.subFolder
        : 'msg';
    let fieldType = fieldType2JSName(field, subFolder);
    let tp = field.type.isPrimitiveType ? '' : typePrefix;
    if (typePrefix === 'rclnodejs.') {
      fieldType = 'any';
      tp = '';
    }

    const tmpl = indentString(`${field.name}: ${tp}${fieldType}`, indent);
    fs.writeSync(fd, tmpl);
    if (field.type.isArray) {
      fs.writeSync(fd, '[]');

      if (fieldType === 'number') {
        // for number[] include alternate typed-array types, e.g., number[] | uint8[]
        let jsTypedArrayName = fieldTypeArray2JSTypedArrayName(field.type.type);

        if (jsTypedArrayName) {
          fs.writeSync(fd, ` | ${jsTypedArrayName}`);
        }
      }
    }

    fs.writeSync(fd, lineEnd);
    fs.writeSync(fd, '\n');
  }
}

function saveMsgConstructorAsTSD(rosMsgInterface, fd) {
  const type = rosMsgInterface.type();
  const msgName = type.interfaceName;

  fs.writeSync(fd, `      export interface ${msgName}Constructor {\n`);

  for (const constant of rosMsgInterface.ROSMessageDef.constants) {
    const constantType = primitiveType2JSName(constant.type);
    fs.writeSync(fd, `        readonly ${constant.name}: ${constantType};\n`);
  }

  fs.writeSync(fd, `        new(other?: ${msgName}): ${msgName};\n`);
  fs.writeSync(fd, '      }\n');
}

function saveSrvAsTSD(rosSrvInterface, fd) {
  const serviceName = rosSrvInterface.type().interfaceName;

  const interfaceTemplate = [
    `export interface ${serviceName}Constructor extends ROSService {`,
    `  readonly Request: ${serviceName}_RequestConstructor;`,
    `  readonly Response: ${serviceName}_ResponseConstructor;`,
    '}',
    '',
  ];

  fs.writeSync(fd, indentLines(interfaceTemplate, 6).join('\n'));
}

function saveActionAsTSD(rosActionInterface, fd) {
  const actionName = rosActionInterface.type().interfaceName;

  const interfaceTemplate = [
    `export interface ${actionName}Constructor {`,
    `  readonly Goal: ${actionName}_GoalConstructor;`,
    `  readonly Result: ${actionName}_ResultConstructor;`,
    `  readonly Feedback: ${actionName}_FeedbackConstructor;`,
    '}',
    '',
  ];

  fs.writeSync(fd, indentLines(interfaceTemplate, 6).join('\n'));
}

function isMsgInterface(rosInterface) {
  return rosInterface.hasOwnProperty('ROSMessageDef');
}

function isInternalActionMsgInterface(rosMsgInterface) {
  let name = rosMsgInterface.type().interfaceName;
  return (
    name.endsWith('_FeedbackMessage') ||
    name.endsWith('_SendGoal_Request') ||
    name.endsWith('_SendGoal_Response') ||
    name.endsWith('_GetResult_Request') ||
    name.endsWith('_GetResult_Response')
  );
}

function isInternalServiceEventMsgInterface(rosMsgInterface) {
  let name = rosMsgInterface.type().interfaceName;
  let subFolder = rosMsgInterface.type().subFolder;
  // Some package puts .srv files under srvs/, e.g., slam_toolbox.
  return (
    (subFolder == 'srv' || subFolder == 'srvs' || subFolder == 'action')
    && name.endsWith('_Event')
  );
}

function isSrvInterface(rosInterface) {
  return (
    rosInterface.hasOwnProperty('Request') &&
    rosInterface.hasOwnProperty('Response')
  );
}

function isInternalActionSrvInterface(rosInterface) {
  if (!isSrvInterface(rosInterface)) return false;

  let name = rosInterface.type().interfaceName;
  return name.endsWith('_GetResult') || name.endsWith('_SendGoal');
}

function isActionInterface(rosInterface, pkgInfos) {
  return (
    rosInterface.hasOwnProperty('Feedback') &&
    rosInterface.hasOwnProperty('Goal') &&
    rosInterface.hasOwnProperty('Result')
  );
}

function isValidService(rosSrvInterface, infos) {
  if (!isSrvInterface(rosSrvInterface)) return false;

  let serviceName = rosSrvInterface.type().interfaceName;
  let requestMsgName = serviceName + '_Request';
  let responseMsgName = serviceName + '_Response';

  let matches = infos.reduce((matchCnt, info) => {
    let infoInterfaceName = info.type().interfaceName;
    if (
      requestMsgName === infoInterfaceName ||
      responseMsgName === infoInterfaceName
    ) {
      matchCnt++;
    }
    return matchCnt;
  }, 0);

  return matches === 2;
}

function isValidAction(rosActionInterface, infos) {
  if (!isActionInterface(rosActionInterface)) return false;

  let actionName = rosActionInterface.type().interfaceName;
  let feedback = actionName + '_Feedback';
  let feedbackMsg = actionName + '_FeedbackMessage';
  let goalMsg = actionName + '_Goal';
  let resultMsg = actionName + '_Result';
  let getResultSrv = actionName + '_GetResult';
  let sendGoalSrv = actionName + '_SendGoal';

  let searches = [actionName, feedback, feedbackMsg, goalMsg, resultMsg];

  const SUCCESS_MATCH_COUNT = searches.length + 2;

  let matches = infos.reduce((matchCnt, info) => {
    let infoInterfaceName = info.type().interfaceName;

    if (
      searches.indexOf(infoInterfaceName) >= 0 ||
      (getResultSrv === infoInterfaceName && isValidService(info, infos)) ||
      (sendGoalSrv === infoInterfaceName && isValidService(info, infos))
    ) {
      matchCnt++;
    }

    return matchCnt;
  }, 0);

  return matches === SUCCESS_MATCH_COUNT;
}

function fieldType2JSName(fieldInfo, subFolder = 'msg') {
  return fieldInfo.type.isPrimitiveType
    ? primitiveType2JSName(fieldInfo.type.type)
    : `${fieldInfo.type.pkgName}.${subFolder}.${fieldInfo.type.type}`;
}

// https://design.ros2.org/articles/idl_interface_definition.html
// https://github.com/ros2/rosidl/blob/master/rosidl_parser/rosidl_parser/definition.py
function primitiveType2JSName(type) {
  let jsName;

  switch (type) {
    case 'char':
    case 'byte':
    case 'octet':

    // signed explicit integer types
    case 'short':
    case 'long':
    case 'long long':

    // unsigned nonexplicit integer types
    case 'unsigned short':
    case 'unsigned long':
    case 'unsigned long long':

    // float point types
    case 'float':
    case 'double':
    case 'long double':

    // signed explicit integer types
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':

    // signed explicit float types
    case 'float32':
    case 'float64':

    // unsigned explicit integer types
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64':
      jsName = 'number';
      break;
    case 'bool':
    case 'boolean':
      jsName = 'boolean';
      break;
    case 'string':
    case 'wstring':
      jsName = 'string';
      break;
  }

  return jsName;
}

function fieldTypeArray2JSTypedArrayName(type) {
  let jsName;

  switch (type) {
    case 'byte':
    case 'octet':
    case 'uint8':
      jsName = 'Uint8Array';
      break;
    case 'char':
    case 'int8':
      jsName = 'Int8Array';
      break;
    case 'int16':
    case 'short':
      jsName = 'Int16Array';
      break;
    case 'uint16':
    case 'unsigned short':
      jsName = 'Uint16Array';
      break;
    case 'int32':
    case 'long':
      jsName = 'Int32Array';
      break;
    case 'uint32':
    case 'unsigned long':
      jsName = 'Uint32Array';
      break;
    case 'float':
    case 'float32':
      jsName = 'Float32Array';
      break;
    case 'double':
    case 'float64':
      jsName = 'Float64Array';
      break;

    case 'long long':
    case 'unsigned long long':
    case 'int64':
    case 'uint64':
      // number
      break;
  }

  return jsName;
}

// example filename: std_msgs_msg_String, sensor_msgs_msg_LaserScan
// result {package: 'std_msgs', type: 'msg', name: 'String'}
function fileName2Typeclass(filename) {
  const regex = /(.+)__(\w+)__(\w+)\.js/;
  const array = filename.split(regex).filter(Boolean);

  if (!array || array.length != 3) {
    // todo: throw error
    console.log('ERRORRROOROR', array);
    return;
  }

  return {
    package: array[0],
    type: array[1],
    name: array[2],
  };
}

function indentString(string, amount) {
  if (!string) {
    return '';
  }

  return ' '.repeat(amount) + string;
}

function indentLines(lines, amount) {
  if (!Array.isArray(lines)) {
    throw new Error('lines must be an array');
  }

  return lines.map((line) => indentString(line, amount));
}

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const tsdGenerator = {
  generateAll,
};

module.exports = tsdGenerator;

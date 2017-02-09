"use strict";

const path = require('path'),
	  fs = require('fs-extra'),
	  inquirer = require('inquirer'),
	  _ = require('lodash'),
	  pluginUtils = require('steamer-pluginutils');

var utils = new pluginUtils();
utils.pluginName = "steamer-plugin-kit";

const prefix = "steamer-";

function KitPlugin(argv) {
	this.argv = argv;
}

KitPlugin.prototype.init = function() {

	try {
		var localConfig = null;

		let argv = this.argv;
		let kit = null,
			kitPath = null,	  
			folder = null;

		let isInstall = argv.install || argv.i || false,
			isUpdate = argv.update || argv.u || false;

		if (isInstall && isInstall !== true) {
			kit = prefix + isInstall;  				 // kit name, for example, steamer-react
			kitPath = path.join(utils.globalNodeModules, kit);  // steamer-react global module
			folder = argv.path || argv.p || kit;	// target folder

			if (fs.existsSync(folder)) {
				throw new Error(folder + " has existed.");  // avoid duplicate folder
			}
		}
		else if (isUpdate) {
			localConfig = this.readLocalConfig();
			kit = localConfig.kit || null;
			kitPath = path.join(utils.globalNodeModules, kit);
			folder = path.resolve();
		}

		let kitConfig = {};

		try {
			kitConfig = require(kit);
		}
		catch(e) {
			throw new Error("The kit " + kit + " is not installed");
		}
		
		let cpyFiles = this.filterCopyFiles(kitConfig.files); // files needed to be copied

		let bkFiles = ["package.json", "tools", "README.md"]; //this.filterBkFiles(kitConfig.files); // backup files

		/**
		 * // .steamer/steamer.plugin-kit.js
		   module.exports = {
			    "plugin": "steamer-plugin-kit",
			    "config": {
			        "kit": "steamer-react"
			    }
			}
		*/

		let opts = {
			kit,
			kitPath,
			folder,
			localConfig,
			kitConfig,
			bkFiles,
			cpyFiles
		};

		if (isUpdate) {
			this.update(opts);
		}
		else if (isInstall) {
			this.install(opts);
		}
	}
	catch(e) {
		console.log(e.stack);
	}
};

/**
 * [copy files]
 * @param  {String} kitPath [kit global module path]
 * @param  {String} folder  [target folder]
 * @param  {String} tpl     [config template]
 */
KitPlugin.prototype.copyFiles = function(kitPath, cpyFiles, folder, config) {

	cpyFiles.map((item) => {
		fs.copySync(path.join(kitPath, item), path.join(folder, item));
	});
	
	fs.ensureFileSync(path.join(folder, "config/steamer.config.js"));
	fs.writeFileSync(path.join(folder, "config/steamer.config.js"), "module.exports = " + JSON.stringify(config, null, 4));
};

KitPlugin.prototype.filterCopyFiles = function(files) {

	var f = [];

	f = f.concat(files);

	f.push("package.json", "src", "tools", "config", "README.md");

	f = _.uniq(f);

	return f;
};

/**
 * [filter backup files/folders]
 * @param  {Array} files [files in package.json]
 * @return {Array}       [backup files/folderes]
 */
KitPlugin.prototype.filterBkFiles = function(files) {
	var f = [];

	f = f.concat(files);

	f = f.filter((item) => {
		return item !== "src";
	});

	f.push("package.json");

	return f;
};

/**
 * [backup files while updating]
 * @param  {String} folder  [target folder]
 * @param  {Array} bkFiles [files needed backup]
 */
KitPlugin.prototype.backupFiles = function(folder, bkFiles) {
	let destFolder = "backup/" + Date.now();
	bkFiles.forEach((item, key) => {
		fs.copySync(path.join(folder, item), path.join(folder, destFolder, item));
		fs.removeSync(path.join(folder, item));
	});
};

/**
 * [copy files while updating]
 * @param  {String} kitPath [kit global module path]
 * @param  {String} folder  [target folder]
 * @param  {String} tpl     [config template]
 * @param  {Array} bkFiles  [files needed backup]
 */
KitPlugin.prototype.copyFilterFiles = function(kitPath, folder, bkFiles) {
	
	bkFiles.forEach((item, key) => {
		fs.copySync(path.join(kitPath, item), path.join(folder, item));
	});

};

/**
 * [create local config]
 * @param  {String} kit    [kit name]
 * @param  {String} folder [target folder]
 * @param  {Object} config [config object]
 */
KitPlugin.prototype.createLocalConfig = function(kit, folder) {
	let config = {
		kit: kit
	};

	let isJs = true,
		isForce = false;

	utils.createConfig(folder, config, isJs, isForce);
};

/**
 * [read local config, usually needed when update starter kit]
 * @param  {String} folder     [target folder]
 * @param  {String} configFile [local config file]
 * @return {Boolean / Object}            [config value]
 */
KitPlugin.prototype.readLocalConfig = function(folder) {
	let isJs = true;

	return utils.readConfig("", isJs);
};

/**
 * [install kit]
 * @param  {Object} opts [options]
 */
KitPlugin.prototype.install = function(opts) {

	let kit = opts.kit,
		kitPath = opts.kitPath,
		folder = opts.folder,
		cpyFiles = opts.cpyFiles,
		kitConfig = opts.kitConfig,
		inquirerConfig = kitConfig.options;

	let config = null;

	inquirer.prompt(
		inquirerConfig
	).then((answers) => {
		// init config
		answers.webserver = answers.webserver || "//localhost:9000/";
		answers.cdn = answers.cdn || "//localhost:8000/";
		answers.port = answers.port || 9000; 
		answers.route = answers.route || "/";

		config = _.merge({}, answers);

		// copy template files
		this.copyFiles(kitPath, cpyFiles, folder, config);

		// create config file, for example in ./.steamer/steamer-plugin-kit.js
		this.createLocalConfig(kit, folder, config);

		console.log(kit + " install success");
	});
};

/**
 * [update kit]
 * @param  {Object} opts [options]
 */
KitPlugin.prototype.update = function(opts) {
	let kit = opts.kit,
		kitPath = opts.kitPath,
		folder = opts.folder,
		localConfig = opts.localConfig,
		bkFiles = opts.bkFiles;

	this.backupFiles(folder, bkFiles);	

	// copy files excluding src
	this.copyFilterFiles(kitPath, folder, bkFiles);

	console.log(kit + " update success");
};


module.exports = KitPlugin;
import 'dotenv/config';
import axios from 'axios';
import fs from 'node:fs';
import unified from 'unified';
import markdown from 'remark-parse';
import slate, { InputNodeTypes } from 'remark-slate';
import FormData from 'form-data';
import { Readable } from 'node:stream';
import { Guild, Media, Project } from './payload-types';
import * as PayloadTypes from './payload-types';

const {
	CMS_URL, API_KEY, BYPASS_KEY, DEFAULT_MEDIA,
} = process.env;

if (!CMS_URL || !API_KEY || !BYPASS_KEY || !DEFAULT_MEDIA) {
	throw new Error('Check environment variables!');
}

// Override the default remark-slate node type names to match Plate defaults
// Note these were copied from Plate rather than directly referencing in order to avoid having to bring in a load of web
// dependencies in backend code.
// format: <remark-slate type>:<plate type>;

const ELEMENT_BLOCKQUOTE = 'blockquote';
const ELEMENT_CODE_BLOCK = 'code_block';
const ELEMENT_H1 = 'h1';
const ELEMENT_H2 = 'h2';
const ELEMENT_H3 = 'h3';
const ELEMENT_H4 = 'h4';
const ELEMENT_H5 = 'h5';
const ELEMENT_H6 = 'h6';
const ELEMENT_IMAGE = 'img';
const ELEMENT_LI = 'li';
const ELEMENT_LINK = 'a';
const ELEMENT_OL = 'ol';
const ELEMENT_PARAGRAPH = 'p';
const ELEMENT_UL = 'ul';
const MARK_BOLD = 'bold';
const MARK_CODE = 'code';
const MARK_ITALIC = 'italic';
const MARK_STRIKETHROUGH = 'strikethrough';

const plateNodeTypes: InputNodeTypes = {
	paragraph: ELEMENT_PARAGRAPH,
	block_quote: ELEMENT_BLOCKQUOTE,
	code_block: ELEMENT_CODE_BLOCK,
	link: ELEMENT_LINK,
	ul_list: ELEMENT_UL,
	ol_list: ELEMENT_OL,
	listItem: ELEMENT_LI,
	heading: {
		1: ELEMENT_H1,
		2: ELEMENT_H2,
		3: ELEMENT_H3,
		4: ELEMENT_H4,
		5: ELEMENT_H5,
		6: ELEMENT_H6,
	},
	emphasis_mark: MARK_ITALIC,
	strong_mark: MARK_BOLD,
	delete_mark: MARK_STRIKETHROUGH, // 'strikeThrough',
	inline_code_mark: MARK_CODE, // 'code',
	thematic_break: 'thematic_break',
	image: ELEMENT_IMAGE,
};

interface IGuild {
	_id: string,
	name: string,
	description: string,
	image: string,
	invite: string,
	debutDate: {
		$date: {
			$numberLong: string;
		}
	},
	color?: string,
}

interface ISubmission {
	_id: {
		$oid: string;
	},
	project: number,
	author?: string,
	srcIcon?: string,
	type: 'image' | 'video' | 'text',
	subtype?: 'picture' | 'artwork',
	src?: string,
	message?: string,
}

interface IMedia {
	_id: {
		$oid: string;
	}
	type: 'image' | 'video' | 'text',
	src?: string,
	message?: string,
}

interface ILink {
	_id: {
		$oid: string;
	}
	name: string,
	link: string,
}

interface ICredit {
	type: 'artwork' | 'code' | 'music' | 'organization',
	user: string,
	pfp: string,
	github?: string,
	twitter?: string,
	youtube?: string,
}

interface IProject {
	_id: number,
	status: 'ongoing' | 'past',
	guild: string,
	media?: IMedia[],
	title: string,
	shortDescription: string,
	description: string,
	links?: ILink[],
	date: {
		$date: {
			$numberLong: string;
		}
	},
	flags?: string[],
	ogImage?: string,
	backgroundMusic?: string,
	credits?: ICredit[],
}

interface IMapping {
	guilds: {
		[key: string]: string;
	};
	projects: {
		[key: number]: string;
	};
	successfullyProcessed: any[];
}

interface PayloadPostResponse<T> {
	message: string;
	doc: T;
}

const guilds: IGuild[] = JSON.parse(fs.readFileSync('./data/guilds.json').toString());
const projects: IProject[] = JSON.parse(fs.readFileSync('./data/projects.json').toString());
const submissions: ISubmission[] = JSON.parse(fs.readFileSync('./data/submissions.json').toString());
const mapping: IMapping = JSON.parse(fs.readFileSync('./data/idmap.json').toString());
const failed: string[] = JSON.parse(fs.readFileSync('./data/failed.json').toString());
const missing: ISubmission[] = [];

const axiosInstance = axios.create({
	baseURL: CMS_URL,
	headers: {
		Authorization: `User API-Key ${API_KEY}`,
		'X-RateLimit-Bypass': BYPASS_KEY,
	},
});

function cacheImage(folder: string, filename: string, file: Buffer) {
	if (!fs.existsSync(`./images/cache/${folder}`)) {
		fs.mkdirSync(`./images/cache/${folder}`, { recursive: true });
	}

	fs.writeFileSync(`./images/cache/${folder}/${filename}`, file);
}

function findImageInCache(folder: string, filename: string, isFailed?: boolean) {
	if (fs.existsSync(`./images/cache/${folder}/${filename}`)) {
		if (isFailed) {
			fs.unlinkSync(`./images/cache/${folder}/${filename}`);
			return null;
		}
		return fs.readFileSync(`./images/cache/${folder}/${filename}`);
	}

	if (fs.existsSync(`./images/orig/${folder}/${filename}`)) {
		if (isFailed) {
			fs.unlinkSync(`./images/cache/${folder}/${filename}`);
			return null;
		}
		const file = fs.readFileSync(`./images/orig/${folder}/${filename}`);
		cacheImage(folder, filename, file);
		return file;
	}

	if (fs.existsSync(`./images/orig/${folder}/${decodeURIComponent(filename)}`)) {
		if (isFailed) {
			fs.unlinkSync(`./images/cache/${folder}/${filename}`);
			return null;
		}
		const file = fs.readFileSync(`./images/orig/${folder}/${decodeURIComponent(filename)}`);
		cacheImage(folder, filename, file);
		return file;
	}

	return null;
}

async function findCacheOrFetch(folder: string, url: string, isFailed?: boolean): Promise<Buffer> {
	const imageUrl = new URL(url);
	const pathSplit = imageUrl.pathname.split('/');
	const filename = pathSplit[pathSplit.length - 1];

	const cachedFile = findImageInCache(folder, filename, isFailed);
	if (cachedFile) return cachedFile;

	const fetchedImage = await axios.get(encodeURI(url), { responseType: 'arraybuffer' });
	const data = Buffer.from(fetchedImage.data);
	cacheImage(folder, filename, data);
	return data;
}

async function migrateSubmission(submission: ISubmission) {
	if (mapping.successfullyProcessed.includes(submission._id.$oid)) return;

	const newSubmission: Omit<PayloadTypes.Submission, 'id' | 'createdAt' | 'updatedAt'> = {
		project: mapping.projects[submission.project],
		type: submission.type,
		author: submission.author ?? 'Anonymous',

		_status: 'published',
	};

	if (submission.subtype) newSubmission.subtype = submission.subtype;
	if (submission.message) newSubmission.message = submission.message;
	if (submission.src && submission.type === 'video') {
		const videoUrl = new URL(submission.src);

		if (videoUrl.host === 's3.fr-par.scw.cloud') {
			missing.push(submission);
			console.error(`Missing video for ${submission._id.$oid}`);
			return;
		}

		newSubmission.url = submission.src;
	}

	if (submission.srcIcon) {
		const imageUrl = new URL(submission.srcIcon);

		if (imageUrl.host !== 's3.fr-par.scw.cloud') {
			try {
				const imageBuffer = await findCacheOrFetch(submission.project.toString(), submission.srcIcon, failed.includes(submission._id.$oid));

				const formData = new FormData();

				const pathSplit = imageUrl.pathname.split('/');

				formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

				const image = await axiosInstance.post<PayloadPostResponse<Media>>(
					'/api/submission-media',
					formData,
					{
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
					},
				);

				if (image) {
					newSubmission.srcIcon = image.data.doc.id;
				}
			} catch (e) {
				console.error('Error fetching submission author icon: ', e);
				return;
			}
		}
	}
	if (submission.type === 'image') {
		const imageUrl = new URL(submission.src!);

		const formData = new FormData();

		const pathSplit = imageUrl.pathname.split('/');

		try {
			if (imageUrl.host !== 's3.fr-par.scw.cloud') {
				const imageBuffer = await findCacheOrFetch(submission.project.toString(), submission.src!, failed.includes(submission._id.$oid));

				formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

				const image = await axiosInstance.post<PayloadPostResponse<Media>>(
					'/api/submission-media',
					formData,
					{
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
					},
				);

				if (image) {
					newSubmission.media = image.data.doc.id;
				}
			} else {
				const imageBuffer = findImageInCache(submission.project.toString(), pathSplit[pathSplit.length - 1]);
				if (!imageBuffer) {
					console.log(`Nothing found for submission: ${submission._id.$oid}`);
					missing.push(submission);
					return;
				}

				formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

				const image = await axiosInstance.post<PayloadPostResponse<Media>>(
					'/api/submission-media',
					formData,
					{
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
					},
				);

				if (image) {
					newSubmission.media = image.data.doc.id;
				}
			}
		} catch (e) {
			console.error(`Below error is for: ${submission._id.$oid}`);
			console.error('Error fetching submission image: ', e);
			failed.push(submission._id.$oid);
			return;
		}
	}

	try {
		await axiosInstance.post('/api/submissions', newSubmission);
	} catch (e) {
		console.error(`Submission creation failed for: ${submission._id.$oid}`);
		console.error(e);
		failed.push(submission._id.$oid);
		return;
	}
	mapping.successfullyProcessed.push(submission._id.$oid);
}

async function migrateProject(project: IProject) {
	const qualifyingSubmissions = submissions.filter((submission) => submission.project === project._id);

	if (mapping.successfullyProcessed.includes(project._id)) {
		for (const submission of qualifyingSubmissions) {
			await migrateSubmission(submission);
		}
		console.log(`Migrated all submissions for: ${project.title}`);
		return;
	}

	const description = await unified()
		.use(markdown)
		.use(slate, { nodeTypes: plateNodeTypes, imageCaptionKey: 'cap', imageSourceKey: 'src' })
		.process(project.description);

	const newProject: Omit<PayloadTypes.Project, 'id' | 'createdAt' | 'updatedAt'> = {
		image: DEFAULT_MEDIA!,
		organizer: mapping.guilds[project.guild],
		shortDescription: project.shortDescription,
		slug: project._id!.toString(),
		status: project.status,
		title: project.title,
		links: project.links?.map((link) => ({ name: link.name, url: link.link })),
		description: description.result! as any,
		date: new Date(Number.parseInt(project.date.$date.$numberLong, 10)).toISOString(),
		devprops: [],

		_status: 'published',
	};

	if (project.backgroundMusic) {
		newProject.devprops!.push({ key: 'backgroundMusic', value: project.backgroundMusic });
	}
	if (project.credits) {
		newProject.devprops!.push({ key: 'credits', value: JSON.stringify(project.credits) });
	}
	if (project.flags) {
		newProject.devprops!.push({ key: 'flags', value: JSON.stringify(project.flags) });
	}

	if (project.ogImage) {
		const imageUrl = new URL(project.ogImage);

		if (imageUrl.host !== 's3.fr-par.scw.cloud') {
			try {
				const imageBuffer = await findCacheOrFetch(project._id.toString(), project.ogImage);

				const formData = new FormData();

				const pathSplit = imageUrl.pathname.split('/');

				formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

				const image = await axiosInstance.post<PayloadPostResponse<Media>>(
					'/api/media',
					formData,
					{
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
					},
				);

				if (image) {
					newProject.ogImage = image.data.doc.id;
				}
			} catch (e) {
				console.error('Error fetching project icon: ', e);
				return;
			}
		}
	}

	interface PayloadProjectMedia {
		type: 'image' | 'video';
		media?: string;
		url?: string;
	}

	const mediaTasks = project.media?.map(async (media): Promise<PayloadProjectMedia | undefined> => {
		if (media.type === 'video') {
			return {
				type: 'video',
				url: media.src,
			} as PayloadProjectMedia;
		}

		if (media.type === 'image') {
			const imageUrl = new URL(media.src!);

			if (imageUrl.host !== 's3.fr-par.scw.cloud') {
				try {
					const imageBuffer = await findCacheOrFetch(project._id.toString(), media.src!);

					const formData = new FormData();

					const pathSplit = imageUrl.pathname.split('/');

					formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

					const image = await axiosInstance.post<PayloadPostResponse<Media>>(
						'/api/media',
						formData,
						{
							maxContentLength: Infinity,
							maxBodyLength: Infinity,
						},
					);

					if (image) {
						return {
							type: 'image',
							media: image.data.doc.id,
						} as PayloadProjectMedia;
					}
				} catch (e) {
					console.error('Error fetching project icon: ', e);
					return undefined;
				}
			}
		}

		return undefined;
	}) ?? [];

	newProject.media = (await Promise.all(mediaTasks)).filter((item) => item !== undefined) as PayloadProjectMedia[];

	const PayloadProject = await axiosInstance.post<PayloadPostResponse<Project>>('/api/projects', newProject).catch(console.error);
	if (!PayloadProject?.data) {
		console.error(`Failed to create project ${project._id} in PayloadCMS`);
		return;
	}
	mapping.projects[project._id] = PayloadProject.data.doc.id;
	mapping.successfullyProcessed.push(project._id);

	for (const submission of qualifyingSubmissions) {
		await migrateSubmission(submission);
	}
	console.log(`Migrated all submissions for: ${project.title}`);
}

async function migrateGuild(guild: IGuild) {
	const qualifyingProjects = projects.filter((project) => project.guild === guild._id);

	if (mapping.successfullyProcessed.includes(guild._id)) {
		for (const project of qualifyingProjects) {
			await migrateProject(project);
			console.log(`Migrated project ${project.title}`);
		}
		return;
	}

	const imageUrl = new URL(guild.image);

	const newGuild: Omit<PayloadTypes.Guild, 'id' | 'createdAt' | 'updatedAt'> = {
		name: guild.name,
		description: guild.description,
		debutDate: new Date(Number.parseInt(guild.debutDate.$date.$numberLong, 10)).toISOString(),
		invite: guild.invite,
		icon: DEFAULT_MEDIA!,

		_status: 'published',
	};

	if (imageUrl.host !== 's3.fr-par.scw.cloud') {
		try {
			const imageBuffer = await findCacheOrFetch('guilds', guild.image);

			const formData = new FormData();

			const pathSplit = imageUrl.pathname.split('/');

			formData.append('file', Readable.from(imageBuffer), { filename: decodeURIComponent(pathSplit[pathSplit.length - 1]).replace(/#/g, '-') });

			const image = await axiosInstance.post<PayloadPostResponse<Media>>(
				'/api/media',
				formData,
				{
					maxContentLength: Infinity,
					maxBodyLength: Infinity,
				},
			);

			if (image) {
				newGuild.icon = image.data.doc.id;
			}
		} catch (e) {
			console.error('Error fetching guild icon: ', e);
			return;
		}
	}

	const PayloadGuild = await axiosInstance.post<PayloadPostResponse<Guild>>('/api/guilds', newGuild).catch(console.error);
	if (!PayloadGuild?.data) {
		console.error(`Failed to create guild ${guild._id} in PayloadCMS`);
		return;
	}
	mapping.guilds[guild._id] = PayloadGuild.data.doc.id;

	mapping.successfullyProcessed.push(guild._id);

	for (const project of qualifyingProjects) {
		await migrateProject(project);
		console.log(`Migrated project ${project.title}`);
	}
}

process.on('exit', () => {
	fs.writeFileSync('./data/idmap.json', JSON.stringify(mapping, null, 4));
	fs.writeFileSync('./data/missing.json', JSON.stringify(missing, null, 4));
	console.log('Written id map to disk');
});

function exitHandler() {
	fs.writeFileSync('./data/idmap.json', JSON.stringify(mapping, null, 4));
	fs.writeFileSync('./data/missing.json', JSON.stringify(missing, null, 4));
	console.log('Written id map to disk');
	process.exit();
}

// do something when app is closing
process.on('exit', exitHandler);

// catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

async function main() {
	const autoSave = setInterval(() => {
		fs.writeFileSync('./data/idmap_auto.json', JSON.stringify(mapping, null, 4));
		fs.writeFileSync('./data/missing_auto.json', JSON.stringify(missing, null, 4));
	}, 5000);

	console.log('Starting migration');
	for (const guild of guilds) {
		await migrateGuild(guild);
		console.log(`Migrated guild ${guild.name}`);
	}
	console.log('Done!');
	clearInterval(autoSave);

	fs.writeFileSync('./data/idmap.json', JSON.stringify(mapping, null, 4));
	fs.writeFileSync('./data/missing.json', JSON.stringify(missing, null, 4));
	fs.writeFileSync('./data/failed.json', JSON.stringify(failed, null, 4));
	console.log('Written id map to disk');

	/* const tasks = submissions.map(migrateSubmission);
	console.log('Starting migration')
	await Promise.all(tasks)
	console.log('Done!') */
}

// eslint-disable-next-line no-void
void main();

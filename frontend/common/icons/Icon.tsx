// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { FC, SVGProps } from 'react';

import MenuSvg from './svg/menu.svg?react';
import DotsVerticalSvg from './svg/dots-vertical.svg?react';
import PencilSvg from './svg/pencil.svg?react';
import TrashSvg from './svg/trash.svg?react';
import SendSvg from './svg/send.svg?react';
import StopSvg from './svg/stop.svg?react';
import CheckSvg from './svg/check.svg?react';
import CopySvg from './svg/copy.svg?react';
import ChatBubbleSvg from './svg/chat-bubble.svg?react';
import ChevronRightSvg from './svg/chevron-right.svg?react';
import NvidiaLogoSvg from './svg/nvidia-logo.svg?react';
import DatabaseSvg from './svg/database.svg?react';
import SettingsSvg from './svg/settings.svg?react';
import ChartBarSvg from './svg/chart-bar.svg?react';
import TableSvg from './svg/table.svg?react';
import ViewSvg from './svg/view.svg?react';
import MaterializedViewSvg from './svg/materialized-view.svg?react';
import SchemaSvg from './svg/schema.svg?react';
import ColumnSvg from './svg/column.svg?react';
import ChartLineSvg from './svg/chart-line.svg?react';
import UsersSvg from './svg/users.svg?react';
import UserSvg from './svg/user.svg?react';
import KeySvg from './svg/key.svg?react';
import TagSvg from './svg/tag.svg?react';
import TermsSvg from './svg/terms.svg?react';
import ExplorationSvg from './svg/exploration.svg?react';
import LinkSvg from './svg/link.svg?react';
import ExternalLinkSvg from './svg/external-link.svg?react';
import ConnectionSvg from './svg/connection.svg?react';
import CertificationSvg from './svg/certification.svg?react';
import CloseSvg from './svg/close.svg?react';
import PlusSvg from './svg/plus.svg?react';
import DownloadSvg from './svg/download.svg?react';
import UploadSvg from './svg/upload.svg?react';
import CodeBracketSvg from './svg/code-bracket.svg?react';
import LightningSvg from './svg/lightning.svg?react';
import DiscoverySvg from './svg/discovery.svg?react';
import FilterSvg from './svg/filter.svg?react';

export enum IconName {
	Close = 'close',
	Plus = 'plus',
	Menu = 'menu',
	DotsVertical = 'dots-vertical',
	Pencil = 'pencil',
	Trash = 'trash',
	Send = 'send',
	Stop = 'stop',
	Check = 'check',
	Copy = 'copy',
	ChatBubble = 'chat-bubble',
	ChevronRight = 'chevron-right',
	NvidiaLogo = 'nvidia-logo',
	Database = 'database',
	Settings = 'settings',
	ChartBar = 'chart-bar',
	ChartLine = 'chart-line',
	Table = 'table',
	View = 'view',
	MaterializedView = 'materialized-view',
	Schema = 'schema',
	Column = 'column',
	Users = 'users',
	User = 'user',
	Key = 'key',
	Tag = 'tag',
	Terms = 'terms',
	Exploration = 'exploration',
	Link = 'link',
	ExternalLink = 'external-link',
	Connection = 'connection',
	Certification = 'certification',
	Download = 'download',
	Upload = 'upload',
	CodeBracket = 'code-bracket',
	Lightning = 'lightning',
	Discovery = 'discovery',
	Filter = 'filter',
}

const icons: Record<IconName, FC<SVGProps<SVGSVGElement>>> = {
	[IconName.Close]: CloseSvg,
	[IconName.Plus]: PlusSvg,
	[IconName.Menu]: MenuSvg,
	[IconName.DotsVertical]: DotsVerticalSvg,
	[IconName.Pencil]: PencilSvg,
	[IconName.Trash]: TrashSvg,
	[IconName.Send]: SendSvg,
	[IconName.Stop]: StopSvg,
	[IconName.Check]: CheckSvg,
	[IconName.Copy]: CopySvg,
	[IconName.ChatBubble]: ChatBubbleSvg,
	[IconName.ChevronRight]: ChevronRightSvg,
	[IconName.NvidiaLogo]: NvidiaLogoSvg,
	[IconName.Database]: DatabaseSvg,
	[IconName.Settings]: SettingsSvg,
	[IconName.ChartBar]: ChartBarSvg,
	[IconName.ChartLine]: ChartLineSvg,
	[IconName.Table]: TableSvg,
	[IconName.View]: ViewSvg,
	[IconName.MaterializedView]: MaterializedViewSvg,
	[IconName.Schema]: SchemaSvg,
	[IconName.Column]: ColumnSvg,
	[IconName.Users]: UsersSvg,
	[IconName.User]: UserSvg,
	[IconName.Key]: KeySvg,
	[IconName.Tag]: TagSvg,
	[IconName.Terms]: TermsSvg,
	[IconName.Exploration]: ExplorationSvg,
	[IconName.Link]: LinkSvg,
	[IconName.ExternalLink]: ExternalLinkSvg,
	[IconName.Connection]: ConnectionSvg,
	[IconName.Certification]: CertificationSvg,
	[IconName.Download]: DownloadSvg,
	[IconName.Upload]: UploadSvg,
	[IconName.CodeBracket]: CodeBracketSvg,
	[IconName.Lightning]: LightningSvg,
	[IconName.Discovery]: DiscoverySvg,
	[IconName.Filter]: FilterSvg,
};

export type IconProps = SVGProps<SVGSVGElement> & {
	name: IconName;
};

export const Icon: FC<IconProps> = ({ name, ...props }) => {
	const SvgComponent = icons[name];
	return <SvgComponent {...props} />;
};

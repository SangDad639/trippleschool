import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Check, ChevronDown, Search, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

// All IANA timezones grouped by region
const TIMEZONE_DATA: { region: string; zones: string[] }[] = [
  {
    region: 'Africa',
    zones: [
      'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers',
      'Africa/Asmara', 'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul',
      'Africa/Bissau', 'Africa/Blantyre', 'Africa/Brazzaville', 'Africa/Bujumbura',
      'Africa/Cairo', 'Africa/Casablanca', 'Africa/Ceuta', 'Africa/Conakry',
      'Africa/Dakar', 'Africa/Dar_es_Salaam', 'Africa/Djibouti', 'Africa/Douala',
      'Africa/El_Aaiun', 'Africa/Freetown', 'Africa/Gaborone', 'Africa/Harare',
      'Africa/Johannesburg', 'Africa/Juba', 'Africa/Kampala', 'Africa/Khartoum',
      'Africa/Kigali', 'Africa/Kinshasa', 'Africa/Lagos', 'Africa/Libreville',
      'Africa/Lome', 'Africa/Luanda', 'Africa/Lubumbashi', 'Africa/Lusaka',
      'Africa/Malabo', 'Africa/Maputo', 'Africa/Maseru', 'Africa/Mbabane',
      'Africa/Mogadishu', 'Africa/Monrovia', 'Africa/Nairobi', 'Africa/Ndjamena',
      'Africa/Niamey', 'Africa/Nouakchott', 'Africa/Ouagadougou', 'Africa/Porto-Novo',
      'Africa/Sao_Tome', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek'
    ]
  },
  {
    region: 'America',
    zones: [
      'America/Adak', 'America/Anchorage', 'America/Anguilla', 'America/Antigua',
      'America/Araguaina', 'America/Argentina/Buenos_Aires', 'America/Argentina/Catamarca',
      'America/Argentina/Cordoba', 'America/Argentina/Jujuy', 'America/Argentina/La_Rioja',
      'America/Argentina/Mendoza', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Salta',
      'America/Argentina/San_Juan', 'America/Argentina/San_Luis', 'America/Argentina/Tucuman',
      'America/Argentina/Ushuaia', 'America/Aruba', 'America/Asuncion', 'America/Atikokan',
      'America/Bahia', 'America/Bahia_Banderas', 'America/Barbados', 'America/Belem',
      'America/Belize', 'America/Blanc-Sablon', 'America/Boa_Vista', 'America/Bogota',
      'America/Boise', 'America/Cambridge_Bay', 'America/Campo_Grande', 'America/Cancun',
      'America/Caracas', 'America/Cayenne', 'America/Cayman', 'America/Chicago',
      'America/Chihuahua', 'America/Costa_Rica', 'America/Creston', 'America/Cuiaba',
      'America/Curacao', 'America/Danmarkshavn', 'America/Dawson', 'America/Dawson_Creek',
      'America/Denver', 'America/Detroit', 'America/Dominica', 'America/Edmonton',
      'America/Eirunepe', 'America/El_Salvador', 'America/Fort_Nelson', 'America/Fortaleza',
      'America/Glace_Bay', 'America/Goose_Bay', 'America/Grand_Turk', 'America/Grenada',
      'America/Guadeloupe', 'America/Guatemala', 'America/Guayaquil', 'America/Guyana',
      'America/Halifax', 'America/Havana', 'America/Hermosillo', 'America/Indiana/Indianapolis',
      'America/Indiana/Knox', 'America/Indiana/Marengo', 'America/Indiana/Petersburg',
      'America/Indiana/Tell_City', 'America/Indiana/Vevay', 'America/Indiana/Vincennes',
      'America/Indiana/Winamac', 'America/Inuvik', 'America/Iqaluit', 'America/Jamaica',
      'America/Juneau', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
      'America/Kralendijk', 'America/La_Paz', 'America/Lima', 'America/Los_Angeles',
      'America/Lower_Princes', 'America/Maceio', 'America/Managua', 'America/Manaus',
      'America/Marigot', 'America/Martinique', 'America/Matamoros', 'America/Mazatlan',
      'America/Menominee', 'America/Merida', 'America/Metlakatla', 'America/Mexico_City',
      'America/Miquelon', 'America/Moncton', 'America/Monterrey', 'America/Montevideo',
      'America/Montserrat', 'America/Nassau', 'America/New_York', 'America/Nipigon',
      'America/Nome', 'America/Noronha', 'America/North_Dakota/Beulah', 'America/North_Dakota/Center',
      'America/North_Dakota/New_Salem', 'America/Nuuk', 'America/Ojinaga', 'America/Panama',
      'America/Pangnirtung', 'America/Paramaribo', 'America/Phoenix', 'America/Port-au-Prince',
      'America/Port_of_Spain', 'America/Porto_Velho', 'America/Puerto_Rico', 'America/Punta_Arenas',
      'America/Rainy_River', 'America/Rankin_Inlet', 'America/Recife', 'America/Regina',
      'America/Resolute', 'America/Rio_Branco', 'America/Santarem', 'America/Santiago',
      'America/Santo_Domingo', 'America/Sao_Paulo', 'America/Scoresbysund', 'America/Sitka',
      'America/St_Barthelemy', 'America/St_Johns', 'America/St_Kitts', 'America/St_Lucia',
      'America/St_Thomas', 'America/St_Vincent', 'America/Swift_Current', 'America/Tegucigalpa',
      'America/Thule', 'America/Thunder_Bay', 'America/Tijuana', 'America/Toronto',
      'America/Tortola', 'America/Vancouver', 'America/Whitehorse', 'America/Winnipeg',
      'America/Yakutat', 'America/Yellowknife'
    ]
  },
  {
    region: 'Antarctica',
    zones: [
      'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/DumontDUrville', 'Antarctica/Macquarie',
      'Antarctica/Mawson', 'Antarctica/McMurdo', 'Antarctica/Palmer', 'Antarctica/Rothera',
      'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok'
    ]
  },
  {
    region: 'Arctic',
    zones: ['Arctic/Longyearbyen']
  },
  {
    region: 'Asia',
    zones: [
      'Asia/Aden', 'Asia/Almaty', 'Asia/Amman', 'Asia/Anadyr', 'Asia/Aqtau',
      'Asia/Aqtobe', 'Asia/Ashgabat', 'Asia/Atyrau', 'Asia/Baghdad', 'Asia/Bahrain',
      'Asia/Baku', 'Asia/Bangkok', 'Asia/Barnaul', 'Asia/Beirut', 'Asia/Bishkek',
      'Asia/Brunei', 'Asia/Chita', 'Asia/Choibalsan', 'Asia/Colombo', 'Asia/Damascus',
      'Asia/Dhaka', 'Asia/Dili', 'Asia/Dubai', 'Asia/Dushanbe', 'Asia/Famagusta',
      'Asia/Gaza', 'Asia/Hebron', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong', 'Asia/Hovd',
      'Asia/Irkutsk', 'Asia/Jakarta', 'Asia/Jayapura', 'Asia/Jerusalem', 'Asia/Kabul',
      'Asia/Kamchatka', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Khandyga', 'Asia/Kolkata',
      'Asia/Krasnoyarsk', 'Asia/Kuala_Lumpur', 'Asia/Kuching', 'Asia/Kuwait', 'Asia/Macau',
      'Asia/Magadan', 'Asia/Makassar', 'Asia/Manila', 'Asia/Muscat', 'Asia/Nicosia',
      'Asia/Novokuznetsk', 'Asia/Novosibirsk', 'Asia/Omsk', 'Asia/Oral', 'Asia/Phnom_Penh',
      'Asia/Pontianak', 'Asia/Pyongyang', 'Asia/Qatar', 'Asia/Qostanay', 'Asia/Qyzylorda',
      'Asia/Riyadh', 'Asia/Sakhalin', 'Asia/Samarkand', 'Asia/Seoul', 'Asia/Shanghai',
      'Asia/Singapore', 'Asia/Srednekolymsk', 'Asia/Taipei', 'Asia/Tashkent', 'Asia/Tbilisi',
      'Asia/Tehran', 'Asia/Thimphu', 'Asia/Tokyo', 'Asia/Tomsk', 'Asia/Ulaanbaatar',
      'Asia/Urumqi', 'Asia/Ust-Nera', 'Asia/Vientiane', 'Asia/Vladivostok', 'Asia/Yakutsk',
      'Asia/Yangon', 'Asia/Yekaterinburg', 'Asia/Yerevan'
    ]
  },
  {
    region: 'Atlantic',
    zones: [
      'Atlantic/Azores', 'Atlantic/Bermuda', 'Atlantic/Canary', 'Atlantic/Cape_Verde',
      'Atlantic/Faroe', 'Atlantic/Madeira', 'Atlantic/Reykjavik', 'Atlantic/South_Georgia',
      'Atlantic/St_Helena', 'Atlantic/Stanley'
    ]
  },
  {
    region: 'Australia',
    zones: [
      'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Broken_Hill', 'Australia/Darwin',
      'Australia/Eucla', 'Australia/Hobart', 'Australia/Lindeman', 'Australia/Lord_Howe',
      'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney'
    ]
  },
  {
    region: 'Europe',
    zones: [
      'Europe/Amsterdam', 'Europe/Andorra', 'Europe/Astrakhan', 'Europe/Athens',
      'Europe/Belgrade', 'Europe/Berlin', 'Europe/Bratislava', 'Europe/Brussels',
      'Europe/Bucharest', 'Europe/Budapest', 'Europe/Busingen', 'Europe/Chisinau',
      'Europe/Copenhagen', 'Europe/Dublin', 'Europe/Gibraltar', 'Europe/Guernsey',
      'Europe/Helsinki', 'Europe/Isle_of_Man', 'Europe/Istanbul', 'Europe/Jersey',
      'Europe/Kaliningrad', 'Europe/Kiev', 'Europe/Kirov', 'Europe/Lisbon',
      'Europe/Ljubljana', 'Europe/London', 'Europe/Luxembourg', 'Europe/Madrid',
      'Europe/Malta', 'Europe/Mariehamn', 'Europe/Minsk', 'Europe/Monaco',
      'Europe/Moscow', 'Europe/Oslo', 'Europe/Paris', 'Europe/Podgorica',
      'Europe/Prague', 'Europe/Riga', 'Europe/Rome', 'Europe/Samara',
      'Europe/San_Marino', 'Europe/Sarajevo', 'Europe/Saratov', 'Europe/Simferopol',
      'Europe/Skopje', 'Europe/Sofia', 'Europe/Stockholm', 'Europe/Tallinn',
      'Europe/Tirane', 'Europe/Ulyanovsk', 'Europe/Uzhgorod', 'Europe/Vaduz',
      'Europe/Vatican', 'Europe/Vienna', 'Europe/Vilnius', 'Europe/Volgograd',
      'Europe/Warsaw', 'Europe/Zagreb', 'Europe/Zaporozhye', 'Europe/Zurich'
    ]
  },
  {
    region: 'Indian',
    zones: [
      'Indian/Antananarivo', 'Indian/Chagos', 'Indian/Christmas', 'Indian/Cocos',
      'Indian/Comoro', 'Indian/Kerguelen', 'Indian/Mahe', 'Indian/Maldives',
      'Indian/Mauritius', 'Indian/Mayotte', 'Indian/Reunion'
    ]
  },
  {
    region: 'Pacific',
    zones: [
      'Pacific/Apia', 'Pacific/Auckland', 'Pacific/Bougainville', 'Pacific/Chatham',
      'Pacific/Chuuk', 'Pacific/Easter', 'Pacific/Efate', 'Pacific/Enderbury',
      'Pacific/Fakaofo', 'Pacific/Fiji', 'Pacific/Funafuti', 'Pacific/Galapagos',
      'Pacific/Gambier', 'Pacific/Guadalcanal', 'Pacific/Guam', 'Pacific/Honolulu',
      'Pacific/Kiritimati', 'Pacific/Kosrae', 'Pacific/Kwajalein', 'Pacific/Majuro',
      'Pacific/Marquesas', 'Pacific/Midway', 'Pacific/Nauru', 'Pacific/Niue',
      'Pacific/Norfolk', 'Pacific/Noumea', 'Pacific/Pago_Pago', 'Pacific/Palau',
      'Pacific/Pitcairn', 'Pacific/Pohnpei', 'Pacific/Port_Moresby', 'Pacific/Rarotonga',
      'Pacific/Saipan', 'Pacific/Tahiti', 'Pacific/Tarawa', 'Pacific/Tongatapu',
      'Pacific/Wake', 'Pacific/Wallis'
    ]
  },
  {
    region: 'UTC',
    zones: ['UTC']
  }
];

// Get GMT offset for a timezone
function getTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    if (offsetPart) {
      // Convert "GMT+7" to "+7" or "GMT-5" to "-5"
      const offset = offsetPart.value.replace('GMT', '');
      if (offset === '') return '+0';
      return offset;
    }
    return '';
  } catch {
    return '';
  }
}

// Format timezone for display
function formatTimezone(timezone: string): { label: string; offset: string } {
  const offset = getTimezoneOffset(timezone);
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  return {
    label: `${timezone.replace(/_/g, ' ')}`,
    offset: `GMT${offset}`
  };
}

// Flatten all timezones for searching
const ALL_TIMEZONES = TIMEZONE_DATA.flatMap(group =>
  group.zones.map(tz => ({
    value: tz,
    ...formatTimezone(tz),
    region: group.region
  }))
);

// Popular timezones to show at top
const POPULAR_TIMEZONES = [
  'local',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC'
];

interface TimezoneSelectorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function TimezoneSelector({ value, onChange, className }: TimezoneSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  // Focus search input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Filter timezones based on search
  const filteredTimezones = useMemo(() => {
    const searchLower = search.toLowerCase().trim();
    if (!searchLower) return null; // Show grouped view when not searching

    return ALL_TIMEZONES.filter(tz => {
      const searchIn = `${tz.value} ${tz.label} ${tz.offset} ${tz.region}`.toLowerCase();
      // Allow searching by offset like "+7", "-5", "gmt+7"
      const offsetSearch = searchLower.replace('gmt', '').replace(' ', '');
      return searchIn.includes(searchLower) || tz.offset.toLowerCase().includes(offsetSearch);
    });
  }, [search]);

  // Get display text for selected value
  const displayValue = useMemo(() => {
    if (value === 'local') {
      return t('timezone.local');
    }
    const tz = ALL_TIMEZONES.find(t => t.value === value);
    if (tz) {
      return `${tz.value.split('/').pop()?.replace(/_/g, ' ')} (${tz.offset})`;
    }
    return value;
  }, [value]);

  const handleSelect = (tz: string) => {
    if (tz === 'local') {
      onChange(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } else {
      onChange(tz);
    }
    setOpen(false);
    setSearch('');
  };

  // Render a timezone item
  const renderItem = (tz: typeof ALL_TIMEZONES[0] | { value: string; label: string; offset: string }) => {
    const isSelected = value === tz.value;
    return (
      <button
        key={tz.value}
        onClick={() => handleSelect(tz.value)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors text-left',
          isSelected
            ? 'bg-blue-500/20 text-blue-400'
            : 'hover:bg-gray-700/50 text-gray-300'
        )}
      >
        <span className="truncate flex-1">{tz.label.replace(/_/g, ' ')}</span>
        <span className="text-gray-500 text-xs ml-2 flex-shrink-0">{tz.offset}</span>
        {isSelected && <Check className="w-4 h-4 ml-2 text-blue-400 flex-shrink-0" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="truncate">{displayValue}</span>
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0"
        align="start"
        sideOffset={4}
      >
        {/* Search input */}
        <div className="p-2 border-b border-gray-700">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('timezone.searchPlaceholder')}
              className="pl-8 h-9 bg-gray-800/50 border-gray-700"
            />
          </div>
        </div>

        <div
          className="h-[300px] overflow-y-auto p-2"
          onWheel={(e) => e.stopPropagation()}
        >
          {filteredTimezones ? (
            // Search results
            filteredTimezones.length > 0 ? (
              <div className="space-y-0.5">
                {filteredTimezones.map(tz => renderItem(tz))}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                {t('timezone.noResult')}
              </div>
            )
          ) : (
            // Grouped view with popular at top
            <>
              {/* Popular timezones */}
              <div className="mb-3">
                <div className="px-2 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('timezone.popular')}
                </div>
                <div className="space-y-0.5">
                  {POPULAR_TIMEZONES.map(tzValue => {
                    if (tzValue === 'local') {
                      return renderItem({ value: 'local', label: t('timezone.local'), offset: '' });
                    }
                    const tz = ALL_TIMEZONES.find(t => t.value === tzValue);
                    if (tz) return renderItem(tz);
                    return null;
                  })}
                </div>
              </div>

              {/* All regions */}
              {TIMEZONE_DATA.map(group => (
                <div key={group.region} className="mb-3">
                  <div className="px-2 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-popover">
                    {group.region}
                  </div>
                  <div className="space-y-0.5">
                    {group.zones.map(tzValue => {
                      const tz = ALL_TIMEZONES.find(t => t.value === tzValue);
                      if (tz) return renderItem(tz);
                      return null;
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

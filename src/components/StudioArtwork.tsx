import { useId } from 'react';

type ArtworkKind = 'coffee' | 'poster' | 'cat' | 'portrait' | 'stickers';

export function StudioArtwork({ kind = 'poster', accent = '#ee9f45', className = '' }: { kind?: ArtworkKind; accent?: string; className?: string }) {
  const uid = useId().replace(/:/g, '');
  return <svg className={className} viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="可交互的原创矢量演示图">
    <defs>
      <linearGradient id={`${uid}-cup`} x1="192" y1="184" x2="409" y2="435" gradientUnits="userSpaceOnUse"><stop stopColor="#fffbf2" /><stop offset="1" stopColor="#e6d4b8" /></linearGradient>
      <linearGradient id={`${uid}-can`} x1="221" y1="181" x2="385" y2="479" gradientUnits="userSpaceOnUse"><stop stopColor="#fff7db" /><stop offset="1" stopColor="#efc866" /></linearGradient>
      <linearGradient id={`${uid}-orange`} x1="130" y1="332" x2="279" y2="501" gradientUnits="userSpaceOnUse"><stop stopColor="#ffc35d" /><stop offset="1" stopColor="#f58d33" /></linearGradient>
      <filter id={`${uid}-shadow`} x="0" y="0" width="600" height="600" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="12" /></filter>
    </defs>
    {kind === 'coffee' && <>
      <circle cx="302" cy="295" r="235" fill="#ecd6b7" />
      <circle cx="302" cy="295" r="212" fill="#e7c9a1" />
      <path d="M100 407L225 200L293 301L353 214L505 407H100Z" fill="#ba7954" opacity=".32" />
      <path d="M69 433L204 270L317 415L412 291L550 433H69Z" fill="#c28c61" opacity=".4" />
      <ellipse cx="305" cy="457" rx="148" ry="23" fill="#895f3e" opacity=".13" filter={`url(#${uid}-shadow)`} />
      <path d="M192 245H397L378 413C376 440 213 440 210 413L192 245Z" fill={`url(#${uid}-cup)`} />
      <path d="M398 271H424C474 271 477 356 407 365H389" stroke="#e8dbc9" strokeWidth="24" />
      <ellipse cx="294" cy="244" rx="103" ry="26" fill="#fff9ed" />
      <ellipse cx="294" cy="244" rx="86" ry="18" fill="#5f3c27" />
      <path d="M251 335L278 297L295 320L312 301L341 335H251Z" fill="#af6e45" />
      <text x="294" y="366" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="12" letterSpacing="4" fill="#8d6245">SHANYE</text>
      <path d="M254 177C229 145 283 135 266 101M300 180C275 144 329 133 311 100M347 177C322 145 376 134 359 101" stroke="#fff8e7" strokeWidth="10" strokeLinecap="round" opacity=".6" />
      <ellipse cx="145" cy="445" rx="13" ry="21" transform="rotate(-38 145 445)" fill="#73523b" /><path d="M132 432L157 458" stroke="#b78a60" strokeWidth="2" />
      <ellipse cx="445" cy="424" rx="13" ry="21" transform="rotate(31 445 424)" fill="#73523b" /><path d="M453 410L436 439" stroke="#b78a60" strokeWidth="2" />
    </>}
    {kind === 'poster' && <>
      <rect width="600" height="600" fill="#edf0e1" />
      <circle cx="517" cy="151" r="197" fill="#dfe7c9" />
      <path d="M35 523C121 444 248 533 325 501C402 469 515 472 600 429V600H0V557L35 523Z" fill="#dbe2c7" />
      <text x="43" y="62" fontFamily="Arial, sans-serif" fontSize="15" letterSpacing="5" fill="#55664a">A LITTLE FRESH</text>
      <text x="42" y="133" fontFamily="Microsoft YaHei, sans-serif" fontWeight="700" fontSize="48" fill="#34432d">把春天</text>
      <text x="42" y="190" fontFamily="Microsoft YaHei, sans-serif" fontWeight="700" fontSize="48" fill="#34432d">装进日常。</text>
      <text x="45" y="222" fontFamily="Microsoft YaHei, sans-serif" fontSize="13" letterSpacing="3" fill="#7d896f">一口鲜活 · 春日限定</text>
      <ellipse cx="348" cy="506" rx="129" ry="19" fill="#557044" opacity=".18" filter={`url(#${uid}-shadow)`} />
      <g transform="rotate(10 345 349)">
        <rect x="263" y="207" width="156" height="285" rx="36" fill={`url(#${uid}-can)`} />
        <ellipse cx="341" cy="209" rx="74" ry="14" fill="#e4d8b5" /><ellipse cx="341" cy="205" rx="72" ry="12" fill="#f9f5e6" /><ellipse cx="341" cy="205" rx="17" ry="5" fill="#b7ae96" />
        <rect x="264" y="256" width="154" height="170" fill={accent} />
        <path d="M264 349C310 306 357 387 418 340V425H264V349Z" fill="#f9e8be" opacity=".5" />
        <text x="341" y="299" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="14" fontWeight="700" letterSpacing="4" fill="#fff9e7">ORANGE</text>
        <text x="341" y="324" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9" letterSpacing="3" fill="#fff9e7">FRESH EVERY DAY</text>
        <circle cx="340" cy="369" r="29" fill="#ffdd92" stroke="#fff4cd" strokeWidth="4" />
        {[0, 60, 120, 180, 240, 300].map(a => <path key={a} d="M340 344V394" stroke="#fff3c9" strokeWidth="2" transform={`rotate(${a} 340 369)`} />)}
        <text x="341" y="459" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="9" letterSpacing="3" fill="#9e8951">NATURE INSIDE</text>
      </g>
      <circle cx="183" cy="436" r="76" fill={`url(#${uid}-orange)`} />
      <circle cx="172" cy="428" r="57" fill="#ffda8b" stroke="#fff1cb" strokeWidth="5" />
      {[0, 45, 90, 135].map(a => <path key={a} d="M172 373V483" stroke="#fff1cb" strokeWidth="3" transform={`rotate(${a} 172 428)`} />)}
      <path d="M200 349C166 293 116 311 130 354C155 368 175 367 200 349Z" fill="#6b8550" /><path d="M136 344L197 350" stroke="#9ba96c" strokeWidth="2" />
      <path d="M456 377C472 339 513 343 512 373C495 391 476 392 456 377Z" fill="#6b8550" />
      <text x="42" y="553" fontFamily="Arial, sans-serif" fontSize="10" letterSpacing="3" fill="#718163">SPRING COLLECTION / 2026</text>
      <rect x="474" y="527" width="82" height="26" rx="13" stroke="#7b8b67" /><text x="515" y="544" textAnchor="middle" fontFamily="Microsoft YaHei, sans-serif" fontSize="10" fill="#607151">新品上市</text>
    </>}
    {kind === 'cat' && <>
      <rect width="600" height="600" rx="24" fill="#fbf0dc" />
      <circle cx="300" cy="315" r="184" fill="#f4dfb7" />
      <path d="M187 246L180 132L263 196H337L420 132L412 246C454 383 404 447 300 447C196 447 148 383 187 246Z" fill={accent} />
      <path d="M199 220L199 167L240 201M359 201L401 166L400 220" fill="#e78d68" />
      <path d="M275 198L294 239M312 199L306 239M344 207L323 245" stroke="#d1803f" strokeWidth="14" strokeLinecap="round" />
      <path d="M218 302Q242 275 264 302M337 302Q359 275 381 302" stroke="#654633" strokeWidth="9" strokeLinecap="round" />
      <ellipse cx="300" cy="337" rx="20" ry="13" fill="#c66f5b" /><path d="M300 347V362M300 361Q281 380 265 365M300 361Q319 380 337 365" stroke="#694c38" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="214" cy="337" rx="23" ry="12" fill="#f4ab79" /><ellipse cx="387" cy="337" rx="23" ry="12" fill="#f4ab79" />
      <path d="M153 319L205 327M153 353L205 345M394 327L447 319M395 345L448 353" stroke="#a87545" strokeWidth="5" strokeLinecap="round" />
      <text x="300" y="516" textAnchor="middle" fontFamily="Microsoft YaHei, sans-serif" fontWeight="700" fontSize="31" fill="#866445">今天也要好好生活</text>
      <path d="M100 172L109 149L119 172L142 181L119 191L109 214L100 191L77 181L100 172Z" fill="#dfb86a" /><circle cx="483" cy="445" r="10" fill="#e9c582" />
    </>}
    {kind === 'portrait' && <>
      <rect width="600" height="600" fill="#eeeaf6" /><circle cx="302" cy="273" r="205" fill="#ded4ed" />
      <path d="M112 600C126 431 180 400 298 400C416 400 474 448 488 600H112Z" fill={accent} />
      <path d="M244 376L238 430C271 467 325 470 363 427L353 375H244Z" fill="#d8a18b" />
      <path d="M196 232C196 125 246 89 314 89C403 89 425 160 413 251L393 352L212 350L196 232Z" fill="#3f3443" />
      <ellipse cx="306" cy="265" rx="99" ry="129" fill="#e8b6a0" />
      <path d="M204 237C248 217 266 181 279 141C312 195 356 204 408 216C406 144 375 107 308 107C241 107 199 165 204 237Z" fill="#3f3443" />
      <path d="M248 270L268 267M337 267L356 270" stroke="#664f4d" strokeWidth="6" strokeLinecap="round" /><path d="M291 324Q309 336 327 324" stroke="#aa706b" strokeWidth="5" strokeLinecap="round" />
      <path d="M304 275L295 299H308" stroke="#c88c7e" strokeWidth="4" strokeLinecap="round" /><ellipse cx="251" cy="300" rx="18" ry="9" fill="#dc9c90" opacity=".6" /><ellipse cx="355" cy="300" rx="18" ry="9" fill="#dc9c90" opacity=".6" />
      <path d="M237 431L280 481L248 513L211 435M362 430L325 481L354 513L388 436" fill="#e9e1f7" />
      <path d="M304 482V599" stroke="#a99ac7" strokeWidth="4" /><circle cx="318" cy="540" r="4" fill="#ded4ed" />
      <circle cx="105" cy="127" r="19" fill="#fff" opacity=".6" /><path d="M470 120H508M489 101V139" stroke="#c4b7dc" strokeWidth="5" strokeLinecap="round" />
    </>}
    {kind === 'stickers' && <>
      <g fill={accent}>
        <ellipse cx="170" cy="181" rx="53" ry="45" transform="rotate(-15 170 181)" /><ellipse cx="107" cy="124" rx="20" ry="29" transform="rotate(-26 107 124)" /><ellipse cx="152" cy="104" rx="20" ry="29" transform="rotate(-9 152 104)" /><ellipse cx="199" cy="108" rx="20" ry="29" transform="rotate(12 199 108)" /><ellipse cx="238" cy="142" rx="20" ry="29" transform="rotate(32 238 142)" />
        <path d="M358 124C394 77 463 122 436 169L391 218L346 171C320 143 333 126 358 124Z" />
        <path d="M111 361C111 326 140 312 183 312C228 312 256 327 256 361V399C256 426 122 426 111 399V361Z" />
      </g>
      <ellipse cx="184" cy="360" rx="70" ry="24" fill="#f9e4c2" /><ellipse cx="184" cy="357" rx="51" ry="13" fill="#bd8b59" />
      <path d="M377 325H481C501 325 517 341 517 361V403C517 423 501 439 481 439H456L427 468V439H377C357 439 341 423 341 403V361C341 341 357 325 377 325Z" fill="#d9d1f5" />
      <circle cx="393" cy="382" r="7" fill="#8f7bc3" /><circle cx="429" cy="382" r="7" fill="#8f7bc3" /><circle cx="465" cy="382" r="7" fill="#8f7bc3" />
      <path d="M286 466L300 433L314 466L347 480L314 494L300 527L286 494L253 480L286 466Z" fill="#e7c774" />
    </>}
  </svg>;
}

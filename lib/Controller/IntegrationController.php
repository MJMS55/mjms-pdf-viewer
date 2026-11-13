<?php
declare(strict_types=1);
namespace OCA\MJMSPdfViewer\Controller;

use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\IRequest;
use OCP\IUserSession;

class IntegrationController extends Controller {
    public function __construct(IRequest $request, private IAppManager $apps, private IUserSession $session) {
        parent::__construct('mjms_pdf_viewer', $request);
    }

    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function managerState(): JSONResponse {
        $user = $this->session->getUser();
        return new JSONResponse([
            'enabled' => $user !== null && $this->apps->isEnabledForUser('mjms_pdf_manager', $user),
        ], 200, ['Cache-Control' => 'no-store']);
    }
}
